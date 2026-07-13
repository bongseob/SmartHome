#pragma once

/**
 * 보드별 설정 템플릿. 실제 배포 시 이 파일을 include/config.h 로 복사해 값을 채운다
 * (include/config.h 는 .gitignore 대상 — 보드마다 다른 Wi-Fi 자격증명이 커밋되지 않도록).
 *
 * 아래 예시 값은 packages/db/src/seed-esp32-sample.ts 가 심어둔 "1f-esp32-a" 보드와
 * 정확히 일치한다. 다른 보드를 플래시할 때는 BOARD_SLUG 등 "이 보드의 UNS 좌표" 절만
 * 그 보드의 실제 코드에 맞춰 바꾸면 된다(예: "b", "2f" ...).
 */

// ── Wi-Fi ────────────────────────────────────────────────────────────────
#define WIFI_SSID     "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// ── MQTT 브로커 ──────────────────────────────────────────────────────────
// 개발: Mosquitto 평문 1883(allow_anonymous). 운영은 TLS(mqtts/8883)로 교체해야 한다
// (PROJECT_RULES §5) — WiFiClientSecure로 netClient를 바꾸고 CA 인증서를 넣으면 된다.
// 기기 인증은 MQTT ID/PW 전제(CLAUDE.md 고정 결정) — 운영 배포 전 반드시 실제 계정으로 교체.
#define MQTT_HOST     "192.168.0.10"
#define MQTT_PORT     1883
#define MQTT_USERNAME "" // 비워두면 익명 접속(개발 브로커 전용)
#define MQTT_PASSWORD ""

// ── 이 보드의 UNS 좌표(packages/db/src/seed-esp32-sample.ts 와 반드시 일치) ────
#define UNS_SITE     "main-site"
#define UNS_BUILDING "esp32-building"
#define UNS_FLOOR    "1f"
#define BOARD_SLUG   "a"                              // "a" 또는 "b"
#define BOARD_CODE   UNS_FLOOR "-esp32-" BOARD_SLUG   // 예: "1f-esp32-a"
#define PANEL_AREA   "panel-" BOARD_SLUG              // 예: "panel-a" (보드가 위치한 분전반)

// ── 릴레이 모듈 극성 ─────────────────────────────────────────────────────
// 대부분의 저가 릴레이 모듈은 active-low(핀을 LOW로 내리면 릴레이가 붙는다). 모듈이
// active-high면 false로 바꾼다.
#define RELAY_ACTIVE_LOW true

// ── 채널(전등) 10개 — GPIO ↔ Area ↔ device.code 매핑 ─────────────────────
// GPIO는 부팅 스트래핑 핀(0/2/12/15)과 입력 전용 핀(34~39), UART0(1/3)을 피한 안전한
// 조합이다. device.code는 seed-esp32-sample.ts가 만든 값과 반드시 같아야 gateway가
// 인식한다(등록 안 된 device면 "미등록 device — state 무시"로 버려진다).
#define CHANNEL_COUNT 10

struct ChannelConfig {
  uint8_t pin;
  const char* area;  // 실제로 불이 켜지는 방(Area.slug)
  const char* code;  // device.code
};

static const ChannelConfig CHANNELS[CHANNEL_COUNT] = {
  {  4, "office",   BOARD_CODE "-light-01" },
  {  5, "corridor", BOARD_CODE "-light-02" },
  { 13, "toilet",   BOARD_CODE "-light-03" },
  { 14, "stairs",   BOARD_CODE "-light-04" },
  { 16, "office",   BOARD_CODE "-light-05" },
  { 17, "corridor", BOARD_CODE "-light-06" },
  { 18, "toilet",   BOARD_CODE "-light-07" },
  { 19, "stairs",   BOARD_CODE "-light-08" },
  { 21, "office",   BOARD_CODE "-light-09" },
  { 22, "corridor", BOARD_CODE "-light-10" },
};
