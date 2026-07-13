#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include <string.h>
#include "config.h"

/**
 * ESP32 릴레이 보드 펌웨어 — 디지털아웃 10채널로 전등을 제어한다.
 *
 * UNS 토픽(PROJECT_RULES §2): enterprise/{site}/{building}/{floor}/{area}/{device}/{suffix}
 *  - 보드 자신(감시장비, MONITORING_EQUIPMENT): {PANEL_AREA}/{BOARD_CODE}/state 에
 *    연결 시 ON(retained) 게시, LWT로 OFFLINE(retained) 게시. 보드는 cmd를 받지 않는다
 *    (제어 대상은 채널이지 보드가 아니다 — 보드가 죽으면 gateway가 하위 채널을 자동으로
 *    OFFLINE 처리한다, packages/db cascadeChildrenOffline 참고).
 *  - 채널(전등, config.h의 CHANNELS[]): {실제 방}/{채널 device.code}/state(retained,QoS1)
 *    게시 + /cmd(QoS1) 구독 + /cmd/ack(QoS1) 게시. 디지털 출력이라 telemetry는 없다.
 *
 * MQTT 프로토콜 버전: 이 보드는 MQTT 3.1.1로 접속한다(PubSubClient). 서버측(API/게이트웨이)
 * 이 붙이는 User Properties(MQTT5)는 서버가 cmd 발행 시 감사 메타데이터를 싣는 용도일 뿐,
 * 기기가 그것을 읽거나 ack에 되실을 필요는 없다 — gateway는 AckPayload JSON 바디만 검사한다
 * (apps/gateway/src/index.ts handleAckMessage). 그래서 저전력 임베디드에 흔한 MQTT 3.1.1
 * 클라이언트로도 프로토콜 계약을 100% 만족한다.
 */

WiFiClient netClient;
PubSubClient mqtt(netClient);

bool channelState[CHANNEL_COUNT];

char boardStateTopic[96];
char channelCmdTopic[CHANNEL_COUNT][96];
char channelAckTopic[CHANNEL_COUNT][96];
char channelStateTopic[CHANNEL_COUNT][96];

static void buildTopic(char* out, size_t outSize, const char* area, const char* device, const char* suffix) {
  snprintf(out, outSize, "enterprise/%s/%s/%s/%s/%s/%s",
           UNS_SITE, UNS_BUILDING, UNS_FLOOR, area, device, suffix);
}

/** NTP 동기화 전에는 실제 epoch를 알 수 없다 — 그 경우 부팅 후 경과(ms)로 대체한다
 *  (통신 자체는 막지 않되, ts가 진짜 epoch가 아닐 수 있음을 감안한 안전한 폴백). */
static uint64_t nowEpochMs() {
  time_t nowSec = time(nullptr);
  if (nowSec < 1700000000) {
    return (uint64_t)millis();
  }
  return (uint64_t)nowSec * 1000ULL;
}

static int relayLevel(bool on) {
  bool activeHigh = !RELAY_ACTIVE_LOW;
  return (on == activeHigh) ? HIGH : LOW;
}

static void publishChannelState(uint8_t idx) {
  char payload[72];
  snprintf(payload, sizeof(payload), "{\"status\":\"%s\",\"ts\":%llu}",
           channelState[idx] ? "ON" : "OFF", (unsigned long long)nowEpochMs());
  mqtt.publish(channelStateTopic[idx], payload, true /* retained */);
}

static void publishBoardState(const char* status) {
  char payload[64];
  snprintf(payload, sizeof(payload), "{\"status\":\"%s\",\"ts\":%llu}", status, (unsigned long long)nowEpochMs());
  mqtt.publish(boardStateTopic, payload, true /* retained */);
}

static void publishAck(uint8_t idx, const char* commandId, const char* status, int reasonCode) {
  char payload[192];
  if (reasonCode >= 0) {
    snprintf(payload, sizeof(payload),
             "{\"commandId\":\"%s\",\"status\":\"%s\",\"reasonCode\":%d,\"ts\":%llu,\"deviceId\":\"%s\"}",
             commandId, status, reasonCode, (unsigned long long)nowEpochMs(), CHANNELS[idx].code);
  } else {
    snprintf(payload, sizeof(payload),
             "{\"commandId\":\"%s\",\"status\":\"%s\",\"ts\":%llu,\"deviceId\":\"%s\"}",
             commandId, status, (unsigned long long)nowEpochMs(), CHANNELS[idx].code);
  }
  mqtt.publish(channelAckTopic[idx], payload, false /* ack는 retained 아님 */);
}

static void applyRelay(uint8_t idx, bool on) {
  channelState[idx] = on;
  digitalWrite(CHANNELS[idx].pin, relayLevel(on));
  publishChannelState(idx);
}

static int channelIndexForCmdTopic(const char* topic) {
  for (uint8_t i = 0; i < CHANNEL_COUNT; i++) {
    if (strcmp(topic, channelCmdTopic[i]) == 0) return i;
  }
  return -1;
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  int idx = channelIndexForCmdTopic(topic);
  if (idx < 0) return; // 우리가 구독한 채널이 아님 — 무시

  StaticJsonDocument<256> doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.printf("[cmd] JSON 파싱 실패: %s\n", err.c_str());
    return;
  }

  const char* commandId = doc["commandId"] | "";
  const char* command = doc["command"] | "";
  const char* target = doc["target"] | "";
  if (commandId[0] == '\0' || command[0] == '\0') return;

  if (strcmp(target, CHANNELS[idx].code) != 0) {
    // 방어적 검증 — 이 채널을 향한 명령이 아니면 실행하지 않는다(발행측 혼선 방지).
    publishAck(idx, commandId, "FAILED", 137);
    return;
  }

  if (strcmp(command, "turn_on") == 0) {
    applyRelay(idx, true);
    publishAck(idx, commandId, "SUCCEEDED", -1);
  } else if (strcmp(command, "turn_off") == 0) {
    applyRelay(idx, false);
    publishAck(idx, commandId, "SUCCEEDED", -1);
  } else {
    publishAck(idx, commandId, "FAILED", 132); // 이 채널이 지원하지 않는 명령
  }
}

static void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[wifi] %s 연결 중", WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
  }
  Serial.printf("\n[wifi] 연결됨 — IP %s\n", WiFi.localIP().toString().c_str());

  configTime(0, 0, "pool.ntp.org", "time.google.com"); // ts를 실제 epoch로 채우기 위한 NTP 동기화
}

static void reconnectMqtt() {
  while (!mqtt.connected()) {
    char willPayload[48];
    snprintf(willPayload, sizeof(willPayload), "{\"status\":\"OFFLINE\",\"ts\":%llu}",
             (unsigned long long)nowEpochMs());

    Serial.printf("[mqtt] %s:%d 연결 시도 (clientId=%s)\n", MQTT_HOST, MQTT_PORT, BOARD_CODE);
    bool ok = mqtt.connect(
        BOARD_CODE,
        MQTT_USERNAME, MQTT_PASSWORD,
        boardStateTopic, 1, true, // LWT: topic, qos, retain
        willPayload);

    if (ok) {
      Serial.println("[mqtt] 연결 성공");
      publishBoardState("ON");
      for (uint8_t i = 0; i < CHANNEL_COUNT; i++) {
        mqtt.subscribe(channelCmdTopic[i], 1);
        publishChannelState(i); // 재연결 시 현재 상태를 retained로 재게시(최신값 유지)
      }
    } else {
      Serial.printf("[mqtt] 연결 실패 rc=%d — 2초 후 재시도\n", mqtt.state());
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);

  for (uint8_t i = 0; i < CHANNEL_COUNT; i++) {
    pinMode(CHANNELS[i].pin, OUTPUT);
    channelState[i] = false;
    digitalWrite(CHANNELS[i].pin, relayLevel(false));

    buildTopic(channelStateTopic[i], sizeof(channelStateTopic[i]), CHANNELS[i].area, CHANNELS[i].code, "state");
    buildTopic(channelCmdTopic[i], sizeof(channelCmdTopic[i]), CHANNELS[i].area, CHANNELS[i].code, "cmd");
    buildTopic(channelAckTopic[i], sizeof(channelAckTopic[i]), CHANNELS[i].area, CHANNELS[i].code, "cmd/ack");
  }
  buildTopic(boardStateTopic, sizeof(boardStateTopic), PANEL_AREA, BOARD_CODE, "state");

  connectWiFi();

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  mqtt.setBufferSize(512);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }
  if (!mqtt.connected()) {
    reconnectMqtt();
  }
  mqtt.loop();
}
