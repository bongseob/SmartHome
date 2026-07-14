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
// 개발 브로커도 인증을 요구한다(allow_anonymous false) — MQTT_USERNAME은 이 보드의
// device.code(예: "1f-esp32-a")와 반드시 같아야 하고, MQTT_PASSWORD는
// `pnpm --filter @smarthome/db run provision:mqtt-auth` 실행 시 콘솔에 한 번만 출력되는
// 값을 그대로 붙여넣는다(평문은 DB에 남지 않아 재출력 불가 — 잃어버리면 그 보드만
// --rotate로 재발급). ACL로 이 보드는 자기 자신+자기 채널 토픽만 쓸 수 있다.
#define MQTT_HOST     "192.168.0.10"
#define MQTT_PORT     1883
#define MQTT_USERNAME "1f-esp32-a"
#define MQTT_PASSWORD "PASTE_PROVISIONED_PASSWORD_HERE"

// ── TLS(mqtts, PROJECT_RULES §5.1) ──────────────────────────────────────
// 프로덕션은 true로 바꾸고 MQTT_PORT를 8883으로, MQTT_CA_CERT를
// infra/tls/generate-certs.sh가 만든 out/ca.crt 내용으로 채운다(사설 CA — 보드가
// Mosquitto의 자체 서명 서버 인증서를 검증하는 데 필요). 이 CA는 서버 인증서 검증용일
// 뿐 보드 자신의 신원증명(계정)과는 무관 — MQTT_USERNAME/PASSWORD는 그대로 쓴다.
// 주의: TLS 핸드셰이크는 실제 시각(NTP) 동기화 후에만 인증서 유효기간 검증이 되고,
// WiFiClientSecure는 평문 대비 메모리를 더 쓴다 — 실기기 검증 전까지는 기본 false 권장.
#define MQTT_USE_TLS  false

static const char* MQTT_CA_CERT = R"EOF(
-----BEGIN CERTIFICATE-----
PASTE infra/tls/out/ca.crt CONTENTS HERE (MQTT_USE_TLS=true 일 때만 사용됨)
-----END CERTIFICATE-----
)EOF";

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
