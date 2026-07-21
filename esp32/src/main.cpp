#include <Arduino.h>
#include <WiFi.h>
#include <MQTT.h>
#include <ArduinoJson.h>
#include <time.h>
#include <string.h>
#include "config.h" // MQTT_USE_TLS 등 매크로를 정의 — 아래 #if보다 먼저 include돼야 한다
#if MQTT_USE_TLS
#include <WiFiClientSecure.h>
#endif

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
 * MQTT 프로토콜 버전: 이 보드는 MQTT 3.1.1로 접속한다(256dpi/arduino-mqtt, lwmqtt 기반).
 * 서버측(API/게이트웨이)이 붙이는 User Properties(MQTT5)는 서버가 cmd 발행 시 감사
 * 메타데이터를 싣는 용도일 뿐, 기기가 그것을 읽거나 ack에 되실을 필요는 없다 — gateway는
 * AckPayload JSON 바디만 검사한다(apps/gateway/src/index.ts handleAckMessage). 그래서
 * 저전력 임베디드에 흔한 MQTT 3.1.1 클라이언트로도 프로토콜 계약을 100% 만족한다.
 *
 * MQTT 라이브러리: 예전엔 PubSubClient를 썼으나, 그 라이브러리는 publish()에 QoS를 지정하는
 * 파라미터 자체가 없어(구독만 QoS1 가능) state/cmd·ack를 QoS1로 발행해야 하는 프로젝트 규칙을
 * 지킬 수 없었다(코드 리뷰 P1 #6). 256dpi/arduino-mqtt(lwmqtt)는 PUBACK을 실제로 추적하는
 * QoS1 publish를 지원하고, PubSubClient와 같은 Client&(WiFiClient/WiFiClientSecure) 기반이라
 * TLS 설정을 그대로 재사용할 수 있다.
 *
 * 주의(라이브러리 공식 안내): MQTT 메시지 콜백 안에서 publish/subscribe를 직접 호출하면
 * 내부 ack 처리와 재진입해 교착 상태가 될 수 있다 — 그래서 onMqttMessage는 실행할 동작을
 * pendingQueue에 적재만 하고, 실제 릴레이 구동·ack 발행은 loop()에서 mqtt.loop() 이후
 * processPendingCommands()가 처리한다.
 */

#if MQTT_USE_TLS
WiFiClientSecure netClient;
#else
WiFiClient netClient;
#endif
// 생성자 인자는 read/write 버퍼 크기(byte) — cmd/ack JSON 페이로드 크기에 맞춰 넉넉히 잡는다
// (예전 PubSubClient의 MQTT_MAX_PACKET_SIZE=512 빌드 플래그와 동등한 의도).
MQTTClient mqtt(512);

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
  mqtt.publish(channelStateTopic[idx], payload, true /* retained */, 1 /* QoS1 */);
}

static void publishBoardState(const char* status) {
  char payload[64];
  snprintf(payload, sizeof(payload), "{\"status\":\"%s\",\"ts\":%llu}", status, (unsigned long long)nowEpochMs());
  mqtt.publish(boardStateTopic, payload, true /* retained */, 1 /* QoS1 */);
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
  mqtt.publish(channelAckTopic[idx], payload, false /* ack는 retained 아님 */, 1 /* QoS1 */);
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

// ─── commandId 중복 처리 방지(멱등성) ─────────────────────────────────────
// MQTT QoS1은 "적어도 한 번" 배달을 보장할 뿐이라 PUBACK 유실·재연결 시 같은 commandId가
// 다시 올 수 있다 — 그때 릴레이를 또 토글하면 안 된다(코드 리뷰 P1 #7). 채널마다 최근 처리한
// commandId N개와 그 결과를 기억해뒀다가, 중복 수신이면 물리 동작 없이 같은 ack만 재발행한다.
#define CMD_HISTORY_SIZE 4
struct CommandHistoryEntry {
  char commandId[40] = "";
  char status[12] = "";
  int reasonCode = -1;
};
static CommandHistoryEntry cmdHistory[CHANNEL_COUNT][CMD_HISTORY_SIZE];
static uint8_t cmdHistoryNext[CHANNEL_COUNT] = {0};

static bool findCachedResult(uint8_t idx, const char* commandId, CommandHistoryEntry* out) {
  for (uint8_t i = 0; i < CMD_HISTORY_SIZE; i++) {
    if (cmdHistory[idx][i].commandId[0] != '\0' && strcmp(cmdHistory[idx][i].commandId, commandId) == 0) {
      *out = cmdHistory[idx][i];
      return true;
    }
  }
  return false;
}

static void recordCommandHistory(uint8_t idx, const char* commandId, const char* status, int reasonCode) {
  uint8_t slot = cmdHistoryNext[idx];
  CommandHistoryEntry& entry = cmdHistory[idx][slot];
  strncpy(entry.commandId, commandId, sizeof(entry.commandId) - 1);
  entry.commandId[sizeof(entry.commandId) - 1] = '\0';
  strncpy(entry.status, status, sizeof(entry.status) - 1);
  entry.status[sizeof(entry.status) - 1] = '\0';
  entry.reasonCode = reasonCode;
  cmdHistoryNext[idx] = (slot + 1) % CMD_HISTORY_SIZE;
}

// ─── 명령 실행 지연 큐 ────────────────────────────────────────────────────
// onMqttMessage(MQTT 콜백) 안에서 mqtt.publish()를 직접 호출하면 라이브러리 내부 ack
// 처리와 재진입해 교착될 수 있다(256dpi/arduino-mqtt 공식 안내) — 콜백은 검증(+중복 판정)만
// 하고 실제 릴레이 구동·ack 발행은 loop()에서 mqtt.loop() 이후에 큐를 비우며 처리한다.
struct PendingCommand {
  uint8_t idx;
  char commandId[40];
  bool applyOn;     // true면 relayValue로 릴레이를 실제로 구동한다(중복 재전송은 false)
  bool relayValue;
  char status[12];  // "SUCCEEDED" / "FAILED"
  int reasonCode;   // -1 = 없음
};

#define PENDING_QUEUE_SIZE 8
static PendingCommand pendingQueue[PENDING_QUEUE_SIZE];
static uint8_t pendingHead = 0;
static uint8_t pendingTail = 0;
static uint8_t pendingCount = 0;

static void enqueuePending(
    uint8_t idx, const char* commandId, bool applyOn, bool relayValue, const char* status, int reasonCode) {
  if (pendingCount >= PENDING_QUEUE_SIZE) {
    Serial.println("[cmd] pending queue full — 명령 드롭(연속 명령이 처리 속도를 초과함)");
    return;
  }
  PendingCommand& slot = pendingQueue[pendingHead];
  slot.idx = idx;
  strncpy(slot.commandId, commandId, sizeof(slot.commandId) - 1);
  slot.commandId[sizeof(slot.commandId) - 1] = '\0';
  slot.applyOn = applyOn;
  slot.relayValue = relayValue;
  strncpy(slot.status, status, sizeof(slot.status) - 1);
  slot.status[sizeof(slot.status) - 1] = '\0';
  slot.reasonCode = reasonCode;
  pendingHead = (pendingHead + 1) % PENDING_QUEUE_SIZE;
  pendingCount++;
}

static void processPendingCommands() {
  while (pendingCount > 0) {
    PendingCommand cmd = pendingQueue[pendingTail];
    pendingTail = (pendingTail + 1) % PENDING_QUEUE_SIZE;
    pendingCount--;

    if (cmd.applyOn) {
      applyRelay(cmd.idx, cmd.relayValue);
    }
    publishAck(cmd.idx, cmd.commandId, cmd.status, cmd.reasonCode);
    // 중복 재전송이어도 다시 기록해 둔다(같은 슬롯을 새로고침할 뿐 — 무해하고 코드가 단순해진다).
    recordCommandHistory(cmd.idx, cmd.commandId, cmd.status, cmd.reasonCode);
  }
}

void onMqttMessage(MQTTClient* /*client*/, char topic[], char bytes[], int length) {
  int idx = channelIndexForCmdTopic(topic);
  if (idx < 0) return; // 우리가 구독한 채널이 아님 — 무시

  StaticJsonDocument<256> doc;
  DeserializationError err = deserializeJson(doc, bytes, length);
  if (err) {
    Serial.printf("[cmd] JSON 파싱 실패: %s\n", err.c_str());
    return;
  }

  const char* commandId = doc["commandId"] | "";
  const char* command = doc["command"] | "";
  const char* target = doc["target"] | "";
  if (commandId[0] == '\0' || command[0] == '\0') return;

  CommandHistoryEntry cached;
  if (findCachedResult(idx, commandId, &cached)) {
    // 이미 처리한 commandId(QoS1 재전달) — 릴레이는 건드리지 않고 같은 ack만 재발행한다.
    enqueuePending(idx, commandId, false, false, cached.status, cached.reasonCode);
    return;
  }

  if (strcmp(target, CHANNELS[idx].code) != 0) {
    // 방어적 검증 — 이 채널을 향한 명령이 아니면 실행하지 않는다(발행측 혼선 방지).
    enqueuePending(idx, commandId, false, false, "FAILED", 137);
    return;
  }

  if (strcmp(command, "turn_on") == 0) {
    enqueuePending(idx, commandId, true, true, "SUCCEEDED", -1);
  } else if (strcmp(command, "turn_off") == 0) {
    enqueuePending(idx, commandId, true, false, "SUCCEEDED", -1);
  } else {
    enqueuePending(idx, commandId, false, false, "FAILED", 132); // 이 채널이 지원하지 않는 명령
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

#if MQTT_USE_TLS
  // TLS 인증서 유효기간(notBefore/notAfter) 검증은 보드의 실제 시각이 필요하다 — NTP 동기화
  // 전에 TLS 핸드셰이크를 시도하면 실패한다(시각이 1970년 근처). 동기화될 때까지 대기하되,
  // NTP UDP가 막힌 방화벽 등 시각 자체를 영영 못 받는 경우 예전엔 여기서 무한정 멈춰
  // MQTT 연결·LWT 등록조차 시도하지 못했다(코드 리뷰 P1 #12). 이 보드엔 RTC가 없어 "마지막
  // 정상 시각"을 보관할 수도 없으므로, 유예 시간 안에 못 받으면 포기하고 넘어간다 — 이후
  // TLS 핸드셰이크는 실패하겠지만 reconnectMqtt()의 기존 재시도+로그 루프가 그 실패를
  // 눈에 보이게 계속 재시도한다(조용한 무한 정지보다 훨씬 낫다).
  Serial.print("[time] NTP 동기화 대기 중");
  const uint32_t ntpTimeoutMs = 30000;
  const uint32_t ntpStart = millis();
  while (time(nullptr) < 1700000000) {
    if (millis() - ntpStart > ntpTimeoutMs) {
      Serial.println(" 시간 초과 — NTP 동기화 실패, 부정확한 시각으로 계속 진행");
      Serial.println("[time] TLS 핸드셰이크가 실패할 수 있음 — reconnectMqtt()가 계속 재시도함");
      return;
    }
    delay(300);
    Serial.print(".");
  }
  Serial.println(" 완료");
#endif
}

static void reconnectMqtt() {
  while (!mqtt.connected()) {
    char willPayload[48];
    snprintf(willPayload, sizeof(willPayload), "{\"status\":\"OFFLINE\",\"ts\":%llu}",
             (unsigned long long)nowEpochMs());

    Serial.printf("[mqtt] %s:%d 연결 시도 (clientId=%s)\n", MQTT_HOST, MQTT_PORT, BOARD_CODE);
    // setWill은 connect() 호출 전에 매번 다시 설정해야 한다(willPayload의 ts를 매 시도 갱신).
    mqtt.setWill(boardStateTopic, willPayload, true /* retained */, 1 /* QoS1 */);
    bool ok = mqtt.connect(BOARD_CODE, MQTT_USERNAME, MQTT_PASSWORD);

    if (ok) {
      Serial.println("[mqtt] 연결 성공");
      publishBoardState("ON");
      for (uint8_t i = 0; i < CHANNEL_COUNT; i++) {
        mqtt.subscribe(channelCmdTopic[i], 1);
        publishChannelState(i); // 재연결 시 현재 상태를 retained로 재게시(최신값 유지)
      }
    } else {
      Serial.printf("[mqtt] 연결 실패 lastError=%d — 2초 후 재시도\n", (int)mqtt.lastError());
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

#if MQTT_USE_TLS
  netClient.setCACert(MQTT_CA_CERT);
#endif
  mqtt.begin(MQTT_HOST, MQTT_PORT, netClient);
  mqtt.onMessageAdvanced(onMqttMessage);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }
  if (!mqtt.connected()) {
    reconnectMqtt();
  }
  mqtt.loop();
  processPendingCommands();
}
