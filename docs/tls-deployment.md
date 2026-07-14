# TLS 배포 가이드 (PROJECT_RULES §5.1)

- 작성일: 2026-07-14
- 상태: 설정 준비 완료, **프로덕션 실배포 검증은 미완료**(배포 인프라 자체가 부록 A.2 열린
  항목 — K8s/VM 등 확정 전까지는 아래 설정을 그대로 쓸지, 이를 기준으로 변환할지 정해지지
  않았다. 로컬 개발 환경은 계속 평문을 쓴다).

## 배경

PROJECT_RULES §5.1은 "모든 MQTT/HTTP 통신은 TLS(wss/mqtts), 평문 포트 비활성화"를 요구한다.
2026-07-13까지 구현은 Mosquitto 인증(계정/ACL)만 켜져 있었고 전송 구간은 평문(1883/9001)이었다
— 이 문서는 그 나머지(TLS 전송 암호화)를 다룬다.

2026-07-14 사용자 결정:
- 적용 범위: **프로덕션 설정만 준비**한다. 로컬 개발(`docker-compose.dev.yml`)은 계속 평문 —
  실배포 인프라가 정해지지 않아 dev에서 실제 동작 검증은 못 했다.
- 인증서: **자체 서명 사설 CA** (공인 CA는 도메인·배포 인프라가 필요해 시기상조).
- ESP32 릴레이 보드도 TLS 대상에 포함한다(`WiFiClientSecure`).

## 구성 요소

| 구간 | 방식 | 관련 파일 |
|---|---|---|
| Mosquitto (기기/서비스 ↔ 브로커) | mqtts(8883), wss(9002) | `infra/mosquitto/mosquitto.prod.conf` |
| apps/api (브라우저 ↔ API/WS) | https/wss | `apps/api/src/index.ts`(`TLS_CERT_FILE`/`TLS_KEY_FILE`) |
| 백엔드 MQTT 클라이언트(api/gateway/scheduler/device-simulator) | mqtts 신뢰 | `packages/mqtt`(`MQTT_CA_FILE`) |
| ESP32 릴레이 보드 | mqtts(`WiFiClientSecure`) | `esp32/src/main.cpp`, `esp32/include/config.example.h`(`MQTT_USE_TLS`) |

서비스 간 인증(§5.3 "mTLS 또는 API Key")은 기존 MQTT 계정(`svc-backend`, 비밀번호 기반 —
API Key와 동등)을 그대로 쓰고 TLS로 전송만 암호화한다. 현재 백엔드 프로세스 사이에는 별도
HTTP 호출이 없어(모두 MQTT/DB로만 통신) mTLS를 추가할 대상 자체가 없다 — 필요해지면 이
문서를 갱신한다.

## 1. 인증서 생성

```bash
infra/tls/generate-certs.sh <배포 호스트명 또는 IP>[,추가 SAN...]
# 예) infra/tls/generate-certs.sh mosquitto.smarthome.local,192.168.0.10
```

산출물은 `infra/tls/out/`(전부 `.gitignore` 대상, 커밋 금지):
- `ca.crt`/`ca.key` — 사설 루트 CA
- `mosquitto.crt`/`.key` — Mosquitto 서버 인증서
- `api.crt`/`.key` — apps/api 서버 인증서

SAN을 실제 배포 호스트명/IP로 정확히 넣어야 한다 — 클라이언트가 접속하는 주소와 인증서
SAN이 다르면 TLS 핸드셰이크가 hostname 검증에서 실패한다.

## 2. Mosquitto

```bash
mkdir -p infra/mosquitto/tls
cp infra/tls/out/ca.crt infra/tls/out/mosquitto.crt infra/tls/out/mosquitto.key infra/mosquitto/tls/
docker compose -f infra/docker-compose.prod.yml up -d
```

`mosquitto.prod.conf`는 평문 리스너(1883/9001) 없이 mqtts(8883)/wss(9002)만 연다. 계정/ACL은
dev와 동일하게 `provision:mqtt-auth`가 만든 `passwd`/`acl`을 그대로 쓴다 — TLS는 전송 구간
암호화만 추가할 뿐 인증 체계를 바꾸지 않는다.

## 3. 백엔드 서비스 (api/gateway/scheduler/device-simulator)

`.env`에 추가:

```bash
MQTT_URL=mqtts://<host>:8883
MQTT_CA_FILE=/path/to/infra/tls/out/ca.crt
```

`packages/mqtt`의 `connect()`가 `MQTT_CA_FILE`을 읽어 `ca` 옵션으로 자동 적용한다(한 곳만
고치면 api/gateway/scheduler/device-simulator 전부에 적용되는 기존 패턴 재사용).

## 4. apps/api (https/wss)

`.env`에 추가:

```bash
TLS_CERT_FILE=/path/to/infra/tls/out/api.crt
TLS_KEY_FILE=/path/to/infra/tls/out/api.key
```

둘 다 있어야 켜진다(하나만 있으면 무시하고 기존처럼 http로 기동 — 개발 편의). 켜지면
`NestFactory.create`가 https.Server로 뜨고, `RealtimeWsServer`(`ws` 패키지)가 그 서버에
attach되므로 `/ws/realtime`도 자동으로 wss가 된다.

## 5. ESP32 릴레이 보드

`esp32/include/config.h`(로컬 전용, `.gitignore` 대상)에서:

```c
#define MQTT_USE_TLS  true
#define MQTT_PORT     8883
static const char* MQTT_CA_CERT = R"EOF(
-----BEGIN CERTIFICATE-----
... infra/tls/out/ca.crt 내용을 그대로 붙여넣는다 ...
-----END CERTIFICATE-----
)EOF";
```

자세한 내용은 [esp32/README.md](../esp32/README.md#tlsmqtts-project_rules-51--프로덕션-전용)
참고.

## 알려진 한계 (후속 필요)

- **프로덕션 실배포 미검증**: 배포 인프라(K8s/VM 등, 부록 A.2)가 정해지지 않아 이번 작업은
  "설정 준비"까지다. 실제 프로덕션 호스트에서 mosquitto.prod.conf/docker-compose.prod.yml로
  기동해 mqtts/wss 핸드셰이크가 실제로 성공하는지 검증 필요.
- **ESP32 TLS 컴파일 미검증**: 이 세션 환경에 PlatformIO CLI가 없어 `MQTT_USE_TLS=true`
  경로는 `pio run` 컴파일조차 못 해봤다. 실기기 적용 전 반드시 컴파일부터 확인할 것.
- **인증서 로테이션 자동화 없음**: `generate-certs.sh`를 재실행하면 새 CA/인증서가 만들어지고,
  기존 클라이언트(백엔드 `MQTT_CA_FILE`, ESP32 `MQTT_CA_CERT`)에는 새 `ca.crt`를 수동으로
  다시 배포해야 한다. 자동 갱신(cert-manager 등)은 배포 인프라 결정 이후 과제.
- **Redis는 TLS 대상 밖**: PROJECT_RULES §5.1은 "MQTT/HTTP"로 범위를 한정해, Redis(자체
  프로토콜)는 이번 TLS 작업에 포함하지 않았다. `docker-compose.prod.yml`은 대신 호스트 포트
  노출을 없애 네트워크 경계로 접근을 좁혔다 — `requirepass` 적용 여부는 배포 인프라 확정 시
  함께 검토.
- **공인 CA 전환 시**: 실제 도메인이 생기면 Let's Encrypt 등으로 바꿀 수 있다 — 그 경우
  `MQTT_CA_FILE`/ESP32 `MQTT_CA_CERT` 배포 자체가 불필요해진다(공개 루트가 이미 신뢰됨).
