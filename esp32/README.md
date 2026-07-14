# ESP32 릴레이 보드 펌웨어 (전등 제어, 채널 10개)

`packages/db/src/seed-esp32-sample.ts`가 심어둔 데이터 모델과 1:1로 대응하는 실제 보드측
펌웨어. 5층 건물 × 층당 보드 2대(`a`/`b`) × 보드당 디지털아웃 10채널 구성을 전제로 한다.

## 왜 이렇게 만들었는지

- **보드 1대 = MQTT 연결 1개.** ESP32는 TLS 세션을 여러 개 동시에 유지하기엔 메모리가
  빠듯해서, 물리 연결은 보드당 하나만 쓴다. 그 연결의 `clientId`/LWT는 **보드 자신**
  (감시장비, `device_role='MONITORING_EQUIPMENT'`)의 정체성이고, 채널(전등) 10개는 같은
  연결로 서로 다른 topic 10세트에 개별 발행/구독한다 — MQTT에서 전혀 문제 없는 패턴이다.
- **보드가 죽으면 채널 10개가 자동으로 OFFLINE 처리된다.** 보드 LWT가 브로커를 통해
  `.../{PANEL_AREA}/{BOARD_CODE}/state`에 OFFLINE(retained)을 게시하면, `apps/gateway`가
  이를 받아 `parent_device_id`로 연결된 채널 10개를 전부 OFFLINE으로 전이시킨다
  (`packages/db` `cascadeChildrenOffline`) — 보드 쪽에서 따로 처리할 게 없다.
- **MQTT 3.1.1로 접속한다(MQTT5 아님).** 서버가 `/cmd` 발행 시 붙이는 MQTT5 User
  Properties(감사 메타데이터: Actor_ID·Session_ID 등)는 서버가 Audit_Log에 남기는 용도이지,
  기기가 읽거나 ack에 되실을 필요가 없다 — `apps/gateway`의 ack 처리는 JSON 바디만 검사한다.
  그래서 임베디드에서 가장 널리 쓰이는 PubSubClient(3.1.1)로도 프로토콜 계약을 100% 만족한다.
- **전등(DO 채널)은 telemetry가 없다.** 디지털 출력이라 주기적으로 보낼 수치가 없으므로
  `state`(값 바뀔 때만, retained) + `cmd`/`cmd/ack`만 쓴다.

## 파일 구성

```
esp32/
  platformio.ini          PlatformIO 프로젝트 설정(보드: esp32dev, 프레임워크: arduino)
  include/config.example.h 보드별 설정 템플릿(Wi-Fi·MQTT·채널 매핑) — 커밋 대상
  include/config.h         실제 배포용 설정(비밀값 포함) — .gitignore 대상, 직접 만든다
  src/main.cpp             펌웨어 본체
```

## 빌드 전 설정

```bash
cp include/config.example.h include/config.h
```

`include/config.h`를 열어 보드마다 다음을 채운다:

| 항목 | 설명 |
|---|---|
| `WIFI_SSID` / `WIFI_PASSWORD` | 이 보드가 붙을 Wi-Fi |
| `MQTT_HOST` / `MQTT_PORT` | Mosquitto 브로커 주소(개발: 평문 1883, 프로덕션: TLS 8883 — 아래 TLS 절 참고) |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | 이 보드의 MQTT 계정. `MQTT_USERNAME`은 `BOARD_CODE`와 동일해야 하고, `MQTT_PASSWORD`는 `pnpm --filter @smarthome/db run provision:mqtt-auth` 실행 시 콘솔에 1회만 출력되는 값(브로커가 `allow_anonymous false` + ACL로 보드별 토픽을 강제한다) |
| `UNS_SITE` / `UNS_BUILDING` / `UNS_FLOOR` / `BOARD_SLUG` | DB의 `device.code`·`mqtt_topic`과 반드시 일치해야 gateway가 인식한다 |
| `CHANNELS[]` | GPIO 핀 ↔ 담당 Area(방) ↔ `device.code` 매핑 |

### TLS(mqtts, PROJECT_RULES §5.1 — 프로덕션 전용)

개발은 평문(1883)을 그대로 쓴다. 프로덕션 배포 시:

1. `infra/tls/generate-certs.sh <배포 호스트명 또는 IP>`로 사설 CA + 서버 인증서 생성(자세한
   내용은 [docs/tls-deployment.md](../docs/tls-deployment.md))
2. `config.h`에서 `MQTT_USE_TLS`를 `true`로, `MQTT_PORT`를 `8883`으로 바꾼다
3. `infra/tls/out/ca.crt` 파일 내용을 그대로 복사해 `MQTT_CA_CERT` PEM 블록에 붙여넣는다
   (이 CA는 서버 인증서 검증용이며, 보드 자신의 계정(`MQTT_USERNAME`/`PASSWORD`)과는 무관)

알려진 한계(미검증):
- `WiFiClientSecure` TLS 핸드셰이크는 평문보다 RAM을 더 쓰고(수십 KB 스택), 핸드셰이크 자체도
  1~3초 걸릴 수 있다 — 이번 변경은 컴파일 스위치만 추가했을 뿐 실기기로 TLS 핸드셰이크를
  검증하지는 못했다(pio가 이 세션 환경에 없어 `pio run` 컴파일조차 재검증 못 함 — 다음
  작업자가 `pio run`/실기기 플래시로 확인할 것)
- 인증서 유효기간(notBefore/notAfter) 검증에는 보드의 실제 시각이 필요해, TLS 활성화 시
  `connectWiFi()`가 NTP 동기화가 끝날 때까지 대기하도록 했다(부팅이 몇 초 늦어질 수 있음)

예시값(`config.example.h`)은 시드 스크립트가 만든 **`1f-esp32-a`** 보드와 정확히 일치한다.
다른 보드를 플래시할 때는 `UNS_FLOOR`/`BOARD_SLUG`와 `CHANNELS[]`의 `device.code`만 그
보드의 실제 값으로 바꾸면 된다 — DB에 없는 코드로 발행하면 gateway가
`미등록 device — state 무시` 로그를 남기고 버린다.

## 배선

- 릴레이 모듈은 보통 **active-low**(핀을 LOW로 내리면 통전)다. 모듈이 반대라면
  `config.h`의 `RELAY_ACTIVE_LOW`를 `false`로 바꾼다.
- GPIO는 부팅 스트래핑 핀(0/2/12/15), 입력 전용 핀(34~39), UART0(1/3)을 피한
  `{4,5,13,14,16,17,18,19,21,22}`를 기본값으로 썼다 — 실제 보드 배선에 맞춰 조정 가능.

## 빌드 / 업로드

```bash
pio run                # 컴파일만
pio run -t upload       # ESP32에 플래시
pio device monitor      # 시리얼 로그 확인(115200bps)
```

## 프로토콜 요약 (packages/contracts와 동일 소스)

| 목적 | 토픽 | QoS | Retained |
|---|---|---|---|
| 보드 자신 상태 | `.../{PANEL_AREA}/{BOARD_CODE}/state` | 1 | ✅ (LWT로 OFFLINE) |
| 채널 상태 | `.../{Area}/{light-code}/state` | 1 | ✅ |
| 채널 명령(구독) | `.../{Area}/{light-code}/cmd` | 1 | – |
| 채널 명령 결과 | `.../{Area}/{light-code}/cmd/ack` | 1 | – |

- `cmd` payload: `{"commandId","command","target","timestamp","args"?}` — `command`는
  `turn_on`/`turn_off`만 처리한다(그 외는 `FAILED` ack, reasonCode 132).
- `cmd/ack` payload: `{"commandId","status","ts","deviceId"}` (`deviceId`는 DB UUID가 아니라
  **device.code 문자열** — gateway가 토픽의 device 세그먼트와 그대로 비교한다).
- `state` payload: `{"status":"ON"|"OFF"|"OFFLINE","ts"}`.

## 검증

`MQTT_USE_TLS=false`(기본값, 개발) 경로는 `pio run`으로 컴파일 성공을 확인했다(RAM 14.7%,
Flash 58.6% 사용, 경고 없음). 실기기가 없어 현장 플래시/실동작 테스트는 못 했다 — 최초 배포
시 `pio device monitor`로 Wi-Fi/MQTT 연결 로그와 각 채널 `turn_on`/`turn_off` ack를 직접
확인할 것을 권장한다.

`MQTT_USE_TLS=true`(TLS) 경로는 이번 세션 환경에 PlatformIO CLI가 없어 컴파일조차
재검증하지 못했다 — 프로덕션에 처음 적용할 때는 반드시 `pio run`으로 컴파일부터 확인할 것.
