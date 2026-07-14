# 구현 추적 문서 — SmartHome IoT 관제 시스템

- 기준 문서: [iot_smarthome_srs.md](../iot_smarthome_srs.md), [PROJECT_RULES.md](../PROJECT_RULES.md)
- 작성일: 2026-07-09 (최근 갱신: 2026-07-14 — M12/M13 실기기·MQTT 인증 진행 + M13 TLS 설정 준비 +
  `device.simulated`(가상/실기기 구분) + M11 AI/HITL 안전 인프라 + M14 CI 파이프라인 + M14 Testcontainers
  통합 테스트 반영)
- 상태 기준: 현재 체크아웃의 코드, 문서, `pnpm build/typecheck/test` 검증 결과
- 목적: 완료/진행/미완료 범위를 한 곳에서 추적하고, 다음 작업자가 바로 이어서 구현할 수 있게 한다.

---

## 1. 상태 요약

| 영역 | 상태 | 근거 |
|---|---:|---|
| 프로젝트 규칙/SRS | 완료 | 루트 `iot_smarthome_srs.md`, `PROJECT_RULES.md`, `AGENTS.md` |
| 모노레포 골격 | 완료 | `pnpm-workspace.yaml`, `turbo.json`, `apps/*`, `packages/*` |
| 설계 문서 초안 | 완료 | `docs/erd.md`, `docs/mqtt-topic-design.md`, `docs/api-spec.md`, `docs/architecture.md` 등 |
| 공유 계약(`packages/contracts`) | 완료 | enum, topic, payload, lifecycle, user properties |
| DB 마이그레이션 초안 | 완료 | `packages/db/migrations/0001` ~ `0010` |
| DB 최소 repository | 완료 | `packages/db/src/repositories.ts`, `packages/db/src/seed.ts` |
| MQTT 래퍼 | 완료 | `packages/mqtt/src/index.ts` |
| Device Simulator M1~M2 | 완료 | connect/LWT/state/telemetry + `/cmd`→ack(멱등성·결함주입) |
| Gateway ingest | 완료 | telemetry/state 수신, batch insert, status update, offline alarm |
| Command + Audit 핵심 경로 | 완료 | `packages/command-flow` 단일 소스, gateway/api MQTT cmd/ack, Redis correlation, timeout sweeper. E2E 검증됨 |
| API 서버 | 진행 중 | NestJS bootstrap, health, command/device API, JWT auth guard, RBAC guard, **WS `/ws/realtime` 완료**, **spatial/devices 목록 API 완료(area 스코프 필터링 포함)** |
| Realtime bridge (M7) | 완료 | `packages/realtime`(Redis pub/sub) + gateway 발행 + api WS 브로드캐스트. E2E 검증됨 |
| Auth/RBAC | 진행 중 | JWT 발급/검증, refresh token 저장/폐기, role/device access guard, MQTT topics claim, **로그인/refresh/logout audit 완료**. 권한변경 API 자체가 아직 없어 그 audit은 미완료 |
| Scheduler (M10) | 완료(MVP) | ONE_TIME/DAILY/WEEKLY/MONTHLY/CRON 발화, DEVICE/GROUP fan-out, command-flow 재사용, ADMIN CRUD API+audit. EVENT 트리거는 이벤트 소스 미정으로 제외. E2E 검증됨 |
| Alarm service (M9) | 완료(MVP) | policy CRUD(ADMIN), threshold 평가(gateway), ack/snooze/resolve/note + audit, 에스컬레이션 sweep, WEBHOOK 실제 발송(PUSH/EMAIL/SMS는 provider 미정 스텁). E2E 검증됨 |
| AI/HITL | 완료(안전 인프라, 2026-07-14) | recommendation 저장·confidence/고위험 게이트·Approve/Reject·감사·학습데이터·승인대기열 화면 완료. 실제 ML/휴리스틱 모델(이상행동/에너지/외출/취침/위험예측)은 범위 밖 — `apps/ai-engine`은 스캐폴딩만 |
| Web dashboard (M8) | 완료(MVP) | `apps/web` Vite+React+Konva. 로그인, Floor Map(area 폴리곤·기기 마커·zoom/pan), Device Drawer(ON/OFF·이력), 실시간 타임라인(WS), **도면 편집 모드(기기 드래그 배치, ADMIN 전용)**, **서버 상태 위젯(Web/API/MQTT/Redis/Gateway/Scheduler/Simulator 프레즌스)**. E2E 검증됨 |
| 실기기 연동 (ESP32 릴레이 보드) | 진행 중 | `esp32/` PlatformIO 펌웨어(디지털아웃 10채널 전등 제어) 완료, `pio run` 컴파일 검증. 보드↔서버 OFFLINE 연쇄 처리(`cascadeChildrenOffline`) 완료. 실제 물리 하드웨어 현장 테스트는 미완료 |
| 운영 보안 | 진행 중 | Mosquitto auth/ACL(보드별 계정 발급 + ACL, `allow_anonymous` 폐지) 완료(2026-07-13). TLS(mqtts/wss) **설정 준비** 완료(2026-07-14, `docs/tls-deployment.md`) — 실제 프로덕션 배포 검증은 미완료. 서비스간은 mTLS 대신 기존 공용 계정(`svc-backend`)을 API Key로 간주하기로 결정 |
| Device 연결 프로토콜 | 완료(백엔드) | Device↔Gateway 구간 연결 방식(TCP_IP/SERIAL/MODBUS_TCP/MODBUS_RTU/ZIGBEE/ZWAVE) + 연결 파라미터를 `PATCH /devices/:id/connection`(ADMIN, audit)으로 설정. Gateway↔플랫폼(MQTT)은 무관·불변. 관리 UI는 M16으로 이동 |
| Admin 관리 화면 (M16) | 완료 | 스케줄/예약, 시스템 기본정보, 도면, 지역(Area), 기기 등록/수정/연결 설정/소프트 폐기까지 실인프라·Playwright E2E 검증 완료 |
| 통합/E2E/성능 테스트 | 진행 중 | CI 파이프라인(lint+typecheck+기존 유닛테스트 124케이스 자동 실행) 완료(2026-07-14, ESLint 최초 도입 포함). **통합(Testcontainers) 완료(2026-07-14)** — `packages/test-support` + `apps/gateway`/`apps/api` 통합 테스트 6케이스 + `integration.yml` CI 편입. E2E(Playwright)·성능은 미착수 |

---

## 2. 검증 기준선

마지막 확인 결과:

| 명령 | 결과 | 비고 |
|---|---:|---|
| `pnpm build` | 통과 | 14개 패키지 build 성공 |
| `pnpm typecheck` | 통과 | 21개 task 성공 |
| `pnpm test` | 통과 | 112개 (contracts 50, db 32, auth 7, command-flow 3, notify 4, scheduler 16) |
| E2E 인제스트 | 통과 | simulator→gateway→telemetry 적재, state 반영, offline alarm (2026-07-09) |
| **E2E 명령 전체 경로** | **통과** | login→`POST /commands`→MQTT→simulator ack→**SUCCEEDED**, 멱등성(published:false), **NO_ACK 결함→TIMED_OUT**. 두 경로 모두 audit 4행 체인(CREATED→PENDING→IN_PROGRESS→종결) DB 검증 (2026-07-09) |
| **E2E 실시간 브리지(M7)** | **통과** | JWT 인증 WS 클라이언트 연결→`POST /commands`(turn_off)→`device.state`(OFF)·`command.status`(SUCCEEDED) 실시간 수신 확인 (2026-07-09) |
| **E2E 인증 audit(M6)** | **통과** | 실인프라(Postgres+Redis+Mosquitto)에서 로그인 실패/성공, refresh 실패(형식 오류·이미 회전된 토큰 재사용)/성공, logout을 직접 호출 후 `audit_log`에 8행이 기대한 actor/target/status로 기록됨을 확인 (2026-07-10) |
| **E2E 웹 대시보드(M8)** | **통과** | 실인프라(api+gateway+simulator+web dev server) 대상 Playwright로 로그인→Floor Map(area 폴리곤·기기 마커) 렌더→마커 클릭→Drawer ON/OFF→실제 MQTT ack로 SUCCEEDED→WS `device.state`/`command.status` 실시간 반영까지 확인, 콘솔 에러 없음 (2026-07-10) |
| **E2E 알람 서비스(M9)** | **통과** | 실인프라에서 alarm_policy 생성(API)→시뮬레이터 telemetry가 threshold(temperature>23) 위반→gateway가 alarm_log RAISE+audit, 로컬 webhook 서버가 초기 알림 수신→8초 후 escalation_rule 발동, 두 번째 webhook(다른 채널) 수신+audit ESCALATE→API로 ACK(감사 기록)→재-ACK 시 409(불법 전이)→RESOLVE 성공. 동일 policy+device 중복 breach 동안 새 알람이 재발행되지 않음(중복 억제) 확인 (2026-07-10) |
| **E2E 스케줄러(M10)** | **통과** | 실인프라에서 ONE_TIME(DEVICE) 스케줄 생성→폴링이 정확히 1회만 발화→command 생성(actor_type=SYSTEM)→시뮬레이터 ack→SUCCEEDED, audit 3행 체인(CREATED→PENDING→IN_PROGRESS) 확인. GROUP 타깃(2개 기기)이 각각 별도 schedule_run+command로 fan-out됨 확인. enable/disable/runs/delete API 및 CRUD audit 확인. 첫 시도에서 `schedule_run.command_id` FK 위반(클레임 시점엔 command가 아직 없음)을 실제로 발견해 수정(commandId를 null로 클레임 후 발행 성공 시 backfill) (2026-07-10) |
| **E2E 기기 관리(M16)** | **통과** | 최신 API(3001)+Web(5174), 실제 Postgres/Redis/Mosquitto에서 Playwright 로그인→기기 생성→`buildDeviceBase()` MQTT 토픽 표시→이름 수정 즉시 반영→MODBUS_TCP 설정→`DECOMMISSIONED` 폐기 및 버튼 비활성화 확인. DB audit 4행(`DEVICE_CREATE/UPDATE/CONNECTION_UPDATE/DECOMMISSION`) 모두 SUCCEEDED, 폐기 후 API 수정은 409 확인 (2026-07-10) |

주의:
- `pnpm test` 통과는 전체 기능 검증이 아니다. 대부분 앱/패키지에는 아직 테스트 파일이 없다.
- `pnpm install` 후 `pnpm-lock.yaml`이 갱신됐다. `packages/db`가 `@smarthome/contracts`를 새로 의존한다.

### 2026-07-09 점검에서 수정된 결함
1. **[보안] API 명령 target 신뢰 문제** — 클라이언트가 준 UNS 세그먼트로 발행해 권한 검사(target.id)와
   실제 발행 토픽이 어긋날 수 있었음 → DB `mqtt_topic`에서 서버가 identity 도출(`parseDeviceBase`).
2. **[레이스] terminal ack가 PENDING에 도착** — 불법 전이로 실패해 성공한 명령이 TIMED_OUT 처리됨
   → `completeCommandFromAck`(한 tx에서 IN_PROGRESS 경유 순차 전이, 중복 ack 멱등).
3. **[정합성] 스위퍼 stuck-command** — Redis correlation 키 TTL 만료 시 DB 전이 없이 zset만 정리해
   명령이 영원히 IN_PROGRESS로 남음 → correlation 소실 시에도 TIMED_OUT 전이 보장.
4. **[견고성] verifyJwt** — 서명 길이 불일치 시 timingSafeEqual RangeError → 길이 선검사.
5. **[운영] 마이그레이션 0011 미적용**(refresh_token 없음→로그인 500) 적용, Redis 컨테이너 기동.

### 알려진 부채 (미수정)
- ~~api ↔ gateway correlation/발행 중복~~ → **해소됨(2026-07-09)**: `packages/command-flow`로 추출,
  api·gateway가 동일 `publishDeviceCommand`·correlation을 재사용. scheduler·HITL도 이 패키지를 쓸 것.
- gateway `idCache` 음성 캐시 무기한(기기 나중 등록 시 재시작 필요), `lastStatus` 무한 성장 — 운영 전 정리.
- simulator `processed` 맵 무한 성장(장기 실행 시) — fleet/M3 때 bounded LRU로.

---

## 3. 완료 상세

### 3.1 Contracts

파일:
- `packages/contracts/src/enums.ts`
- `packages/contracts/src/topics.ts`
- `packages/contracts/src/payloads.ts`
- `packages/contracts/src/userProperties.ts`
- `packages/contracts/src/lifecycle.ts`

완료:
- 도메인 enum 단일 소스화
- UNS topic 생성: `buildTopic()`, `buildDeviceBase()`
- UNS topic 역파싱: `parseTopic()`
- QoS/Retained 매핑
- MQTT payload Zod schema
- MQTT 5 User Properties 변환
- 명령 수명주기 상태머신
- contracts 테스트 26개 통과

추적 포인트:
- 새 enum/도메인 타입은 반드시 이 패키지에 먼저 추가한다.
- topic 문자열 하드코딩 금지. 수신측 topic 해석도 `parseTopic()`을 사용한다.

### 3.2 DB

파일:
- `packages/db/migrations/*.sql`
- `packages/db/src/pool.ts`
- `packages/db/src/repositories.ts`
- `packages/db/src/seed.ts`

완료:
- 공간, 기기, RBAC, command/audit, alarm, scheduler, AI/HITL, OTA, telemetry 스키마 초안
- `pg` pool 및 transaction helper
- gateway ingest용 repository:
  - `getDeviceIdByCode()`
  - `setDeviceStatus()`
  - `insertTelemetryBatch()`
  - `raiseOfflineAlarm()`
- `thermostat-01` 개발 seed

추적 포인트:
- DB 변경은 마이그레이션 파일로만 한다.
- command 상태 전이와 audit 기록은 같은 transaction으로 묶어야 한다.
- telemetry retention/continuous aggregate는 아직 구현되지 않았다.

### 3.3 MQTT / Gateway / Simulator

완료:
- `packages/mqtt`: mqtt.js wrapper, LWT, publish 규칙
- `apps/device-simulator`: `thermostat-01` state/telemetry 발행
- `apps/gateway`: shared subscription으로 `telemetry`/`state` 수신

Gateway M1 흐름:
1. Mosquitto 연결
2. `$share/gw/enterprise/+/+/+/+/+/telemetry` 구독
3. `$share/gw/enterprise/+/+/+/+/+/state` 구독
4. telemetry payload 검증
5. device id lookup
6. metric별 row 변환
7. 500ms 단위 batch insert
8. state payload 검증
9. device current_status 갱신
10. `OFFLINE`이면 `alarm_log` 기록

추적 포인트:
- ~~gateway command 발행/ack 미처리~~ → 완료. 발행/상관은 `@smarthome/command-flow` 단일 소스,
  ack는 `completeCommandFromAck`(PENDING 레이스 흡수), 스위퍼는 correlation 소실 시에도 TIMED_OUT 보장.
- simulator M2: `/cmd`→ack(멱등성: 동일 commandId 재실행 금지·ack 재전송), 결함주입
  `SIM_FAULT=noack:<cmd>|fail:<cmd>[:code]`, turn_on/off 시 state(retained) 반영.
- offline alarm 중복 억제 정책은 최소 상태 변화 기준이며, 운영 기준은 추가 설계가 필요하다.

---

## 4. 전체 구현 계획

### M2. Gateway ingest 안정화

상태: 진행 가능

작업:
- gateway ingest 단위 테스트 추가
- repository 테스트 추가
- invalid topic/payload 로깅 정책 추가
- 미등록 device 처리 정책 확정
- offline alarm 중복/해제 정책 정리
- seed 실행 방법 README 또는 docs에 등록

완료 조건:
- invalid topic/payload가 프로세스를 죽이지 않는다.
- 등록된 simulator telemetry가 DB에 적재된다.
- OFFLINE state가 status update와 alarm_log를 만든다.
- 관련 테스트가 추가된다.

### M3. Command + Audit 핵심 경로

상태: 완료

작업:
- command repository 구현 완료
- audit_log repository 구현 완료
- commandId 멱등성 처리 완료(DB service 기준)
- 상태 전이 함수 구현 완료(DB service 기준)
- `CREATED -> PENDING -> IN_PROGRESS -> SUCCEEDED/FAILED/TIMED_OUT` 강제 완료(DB service 기준)
- 모든 전이마다 audit_log 1행 기록 완료(DB service 기준)
- 상태 전이와 audit 기록을 동일 transaction으로 처리 완료(DB service 기준)
- MQTT `/cmd` 발행 구현 완료(gateway `publishDeviceCommand()`)
- MQTT `/cmd/ack` 수신 구현 완료(gateway shared subscription)

완료 조건:
- DB service를 통하지 않는 기록 없는 상태 전이는 만들지 않는다.
- 상태 건너뛰기 전이가 실패한다. 완료
- 정상/실패/타임아웃/중복 commandId 테스트가 통과한다. 부분 완료: 정상/실패/불법 전이/중복 commandId 테스트 추가, 타임아웃 경로는 MQTT/스위퍼 구현 시 추가
- MQTT command 발행과 ack 수신이 DB service를 재사용한다. 완료
- Redis command correlation과 timeout sweeper까지 M4에서 연결 완료.

### M4. Redis command correlation

상태: 완료

작업:
- Redis dependency 추가 완료
- `cmd:{commandId}` correlation state 저장 완료
- `cmd:timeouts` sorted set으로 SLA deadline 추적 완료
- gateway 다중 인스턴스 기준 ack 상관 처리 완료
- timeout sweeper 구현 완료
- SLA 초과 시 `TIMED_OUT` 전이 및 audit 기록 완료

완료 조건:
- command 발행 인스턴스와 ack 수신 인스턴스가 달라도 Redis key로 상관할 수 있다.
- SLA 초과 command가 자동으로 `TIMED_OUT` 된다.
- Redis correlation 저장/갱신/삭제 테스트가 통과한다.

### M5. API 서버 기반

상태: **완료** (E2E 검증: login→POST /commands→ack→SUCCEEDED/TIMED_OUT + audit 체인, 2026-07-09)

작업:
- NestJS bootstrap 완료
- health endpoint 완료: `GET /health`
- `POST /commands` 완료: `POST /api/v1/commands`
- `GET /commands/{commandId}` 완료: `GET /api/v1/commands/:commandId`
- device state/history 최소 조회 완료: `GET /api/v1/devices/:id/state`, `GET /api/v1/devices/:id/history`
- problem+json 에러 포맷 완료
- OpenAPI skeleton 완료: `docs/openapi.yaml`

완료 조건:
- API를 통해 command를 생성하고 MQTT `/cmd` 발행 및 Redis correlation을 생성할 수 있다. 완료
- command 상태를 API로 조회할 수 있다. 완료
- device state/history를 API로 조회할 수 있다. 완료
- 인증/RBAC 적용은 M6에서 진행한다.

### M6. Auth/RBAC

상태: 진행 중

작업:
- JWT 자체 발급/검증 완료: `packages/auth`
- refresh token 저장/폐기 완료: `refresh_token` migration + API refresh/logout
- role guard 완료: API 전역 guard
- Area/Device access guard 완료: device state/history, command create에 적용
- Group access guard 미완료: group API 구현 시 적용
- MQTT ACL용 `topics` claim 생성 완료: ADMIN=`enterprise/#`, area permission 기반 wildcard
- 로그인/refresh/logout audit 완료: `AuthService`가 성공/실패 모두 `audit_log`에 기록
  (target은 계정 자신, `command`=LOGIN/REFRESH/LOGOUT, `execution_status`=SUCCEEDED/FAILED 재사용)
- 권한 변경 audit: 권한 변경 API 자체가 아직 없어 보류(해당 API 구현 시 함께 추가)

완료 조건:
- 권한 없는 Device 조회/제어가 거부된다. 완료
- JWT claim으로 MQTT ACL 정책을 만들 수 있다. 완료
- 로그인/refresh/logout audit이 남는다. 완료(2026-07-10 E2E 검증)
- 권한변경 audit은 권한변경 API 구현 시점으로 이월.

### M7. Realtime Dashboard Bridge

상태: **완료** (E2E 검증: gateway→Redis pub/sub→api WS 클라이언트 실시간 수신, 2026-07-09)

작업:
- API WebSocket `/ws/realtime` 완료: `apps/api/src/realtime/realtime-ws.server.ts`
  (`ws` 패키지, NestJS HTTP 서버에 attach, JWT는 쿼리스트링 `?token=`로 인증)
- contracts에 `RealtimeEvent`(discriminated union: device.state/alarm.raised/command.status) 추가
- `packages/realtime` 신설: Redis pub/sub 발행/구독 단일 소스(`REALTIME_CHANNEL`)
  — publish용과 subscribe용은 항상 별도 Redis 연결(node-redis 구독 모드 제약)
- gateway가 3개 훅에서 이벤트 발행: state 변경(device.state), OFFLINE 감지(alarm.raised),
  ack/타임아웃 종결(command.status) — `completeCommandFromAck`/`lockFreeTimeoutTransition` 재사용
- dashboard overview API는 M8 선행 작업으로 이월(별도 항목)

완료 조건:
- state 변경과 command 상태 변경이 WebSocket으로 전달된다. **완료** — 실인프라(Mosquitto+Redis+Postgres)에서
  JWT 인증 WS 클라이언트가 `POST /commands`(turn_off) 발행 후 `device.state`(OFF)와
  `command.status`(SUCCEEDED) 이벤트를 실시간 수신함을 확인.

알려진 단순화(후속 필요):
- **브로드캐스트 방식**: 인증된 전 연결에 전체 이벤트 브로드캐스트. Area/Device 단위 구독 필터링
  (JWT `topics` claim 기준)은 M8 진행하며 필요 시 추가 — 이벤트에 deviceId만 있고 UNS 토픽이 없어
  현재는 device→area 매핑 조회가 필요함.
- **재연결 시 누락분 catch-up 없음**: 연결 끊긴 동안의 이벤트는 유실(재연결 시 REST로 현재 상태 재조회 필요).

### M8. Web Dashboard

상태: **완료(MVP)** (E2E 검증: Playwright로 로그인→Floor Map→Drawer ON/OFF→실시간 반영 확인, 2026-07-10)

작업:
- Vite + React bootstrap 완료: `apps/web`(별도 tsconfig — bundler resolution, 다른 Node 패키지의
  NodeNext 기반 tsconfig.base와는 의도적으로 분리)
- Konva floor map 완료: floor_map 배경 이미지, Area polygon, 기기 마커(상태색, §6.1 색상 고정 매핑),
  wheel zoom + drag pan
- device drawer 완료: 상태 배지, ON/OFF 명령 버튼, 명령/감사/알람 이력 통합 타임라인
- command button 완료: `POST /commands` 연동, 진행 상태(PENDING→…) 인라인 표시
- timeline/alarm panel 완료: `EventFeed` — WS로 받은 `device.state`/`alarm.raised`/`command.status`를
  최근 50개 스트림으로 표시
- WebSocket 연결 완료: `useRealtime` 훅, 인증 만료(4401) 시 재연결 대신 로그아웃 위임, 그 외 종료는
  3초 후 재연결
- **도면 편집 모드 완료(2026-07-10 추가)**: 실행/편집 모드 토글(ADMIN 전용), 편집 모드에서 기기 마커
  드래그로 위치 이동, dirty 변경 건수 배지 + 저장/취소, 층 전환·모드 이탈 시 미저장 변경 확인
  다이얼로그, 편집 모드에서는 ON/OFF 제어 비활성화(오조작 방지). 백엔드
  `PATCH /api/v1/spatial/floors/:id/layout`(ADMIN 전용, 위치 일괄 저장 + `DEVICE_RELOCATE` audit,
  한 transaction으로 처리)

완료 조건:
- Floor Map에서 device 상태가 표시된다. 완료
- 사용자가 허가된 device command를 보낼 수 있다. 완료(백엔드 `DeviceAccessGuard`가 최종 검증;
  프런트는 버튼을 항상 노출하고 403을 에러로 표시 — 세밀한 액션 단위 숨김은 후속)
- 알람/타임라인이 실시간으로 갱신된다. 완료

MVP 범위 밖으로 의도적으로 제외한 것(ui-ux-design.md 전체 스펙 대비):
- 카메라/PTZ, 알람 센터 전용 화면, HITL 승인함, 스케줄러 화면, 관리(Admin) 화면 — 각각 해당 백엔드
  마일스톤(M9~M13)과 함께 후속 진행
- 편집 모드 중 Area(Polygon) 생성/편집, 미배치 기기 드롭 배치, Grid Snap — 이번엔 "기기 위치 드래그"만
  구현(사용자 요청 범위)

알려진 단순화(후속 필요):
- ~~**WS 브로드캐스트 미스코프**~~ → **해소됨(2026-07-10)**: `RealtimeWsServer`가 연결별 `AuthContext`를
  보관하고, device→area 매핑을 30초 캐시로 조회해 JWT `topics` claim과 대조한다(ADMIN은 전체 수신,
  캐시 미반영·area 미배정 기기는 안전하게 숨김 — fail-closed). GROUP 대상 이벤트는 area로 스코프할
  방법이 없어 비-ADMIN에게는 숨기고(현재 실제로는 발생하지 않음 — command 발행은 항상 DEVICE 단위로
  fan-out), 기기 없는 알람(전사 공지성)은 전체에 알린다. E2E(실제 WS 클라이언트 2개, area 권한이
  다른 사용자)로 검증: `living-room-user`는 거실 기기 이벤트만 수신하고 침실 기기 이벤트는 받지
  못함을 확인
- **시뮬레이터 단일 기기**: `apps/device-simulator`는 `thermostat-01`만 ack한다. seed의 `light-01`/
  `light-02`에 ON/OFF를 보내면 ack가 없어 SLA(30s) 후 `TIMED_OUT`으로 종결된다 — fleet 확장(M3 부채,
  §3.3)과 함께 해소 예정.
- **큰 번들 경고**: `vite build` 결과 단일 청크 512KB(konva 포함) — 코드 스플리팅은 성능 튜닝(M15)과 병행.
- **편집 모드 드래그 버그 2건 발견 및 수정(2026-07-10)**:
  1. Konva `<Stage>`가 팬(pan)을 위해 항상 `draggable`이었는데, 편집 모드에서 기기 마커도
     `draggable`이 되면서 같은 드래그 제스처를 Stage가 가로채 마커 대신 도면 전체가 팬되는 버그.
     편집 모드에서는 Stage의 `draggable`을 꺼서 해결(`draggable={!editMode}`).
  2. **(실사용자 리포트로 발견)** 드래그 도중에는 멀쩡하다가 드롭하는 순간 배경(도면)이 기기 위치로
     튀는 버그. 원인은 Konva 이벤트 버블링 — 기기 `Group`의 `dragend`가 `Stage`까지 버블링되어
     Stage의 `onDragEnd`(팬 상태 갱신용)가 다시 실행되는데, 이때 `e.target`은 Stage가 아니라 그
     Group이라 좌표가 기기의 드롭 위치가 되어버려 그 값으로 캔버스를 패닝했다. `e.target !==
     e.target.getStage()`면 무시하도록 가드하고, Group 쪽에서도 `e.cancelBubble = true`로 전파를
     막아 근본 차단. Playwright 자동화로는 stage pos가 그대로 있음을 재현/검증했지만, 최초 발견은
     사용자의 실제 브라우저 사용 중 리포트였다 — 자동화 재현이 어려운 유형의 버그였다.
  3. 실시간(WS) 갱신처럼 드래그 도중 끼어드는 리렌더가 Konva의 드래그 중 위치를 되돌려쓰는 문제를
     막기 위해 `onDragMove`로 드래그 중 위치를 별도 state(`dragPreview`)로 추적해 항상 최신 위치를
     넘기도록 방어적으로 처리.
- **마커 도면 이탈 방지(2026-07-10 추가)**: `dragBoundFunc`로 기기 마커가 floor_map 경계(반지름+여백
  12px) 밖으로 드래그되지 않도록 클램프. Stage의 scale/pan을 고려해 절대좌표↔도면 로컬좌표를 변환한
  뒤 클램프하고 다시 절대좌표로 되돌린다 — 화면 밖 멀리 드래그해도 도면 가장자리에서 멈추는 것을
  Playwright로 확인(`width-12, height-12`로 정확히 클램프됨). 백엔드 `PATCH .../layout`은 좌표 범위를
  검증하지 않는다 — 프런트가 항상 클램프한 값만 보내므로 정상 경로에서는 문제없지만, 클라이언트를
  신뢰하지 않는 방어적 검증은 아직 없음(후속 필요 시 추가).
- **테스트 한계**: 같은 Playwright 세션에서 첫 번째 드래그 제스처는 항상 정상 동작하지만, 이후 반복되는
  합성 마우스 드래그는 캔버스에 `mousedown` 네이티브 이벤트 자체가 전달되지 않는 현상을 확인했다
  (Konva `DD.isDragging`은 정상적으로 `false`, JS 에러 없음 — 앱 코드가 아니라 headless Chromium의
  합성 입력 처리 특성으로 보인다). 개별 드래그 동작(다른 기기·다른 위치)은 반복 검증했고 모두 정확했다
  — 실제 마우스로 연속 드래그가 되는지는 이 세션에서 자동화로 끝까지 확인하지 못했다.

완료된 작업 단위 — 서버 상태 위젯(2026-07-13):
1. 새 HTTP 포트 없이 gateway/scheduler/device-simulator가 이미 맺고 있는 MQTT 연결의 LWT(retained)로
   프레즌스(ONLINE/OFFLINE)를 게시하고, api가 이를 구독해 `GET /health/system`(ADMIN)으로 취합
2. 헤더에 드래그 가능한 단일 위젯(위치는 `localStorage` 저장), 노출 여부는 메뉴가 아닌 우측 체크박스로 분리
3. 실사용 중 발견한 버그 2건 수정: api의 MQTT connect 리스너가 redis/publisher await보다 늦게 등록돼
   레이스로 프레즌스 구독이 누락되던 문제, scheduler가 브로커 재연결 후 ONLINE을 다시 게시하지 않던 문제
4. Redis 소켓 오류가 `uncaughtException`으로 새어나와 gateway/scheduler/api 프로세스 전체가 죽던 문제를
   process 레벨 가드로 차단(로그만 남기고 node-redis 기본 재연결에 위임)

### M9. Alarm Service

상태: **완료(MVP)** (E2E 검증: policy 생성→threshold 위반→alarm 발생→webhook 발송→escalation→ack→resolve, 2026-07-10)

작업:
- alarm_policy CRUD 완료: `POST/GET /api/v1/alarm-policies`, `PATCH /:id/enabled` (ADMIN 전용, SRS 2.1.5)
- telemetry threshold evaluation 완료: gateway가 활성 정책을 30초 주기로 캐시하고, telemetry 수신마다
  `compareThreshold()`로 평가. `duration_sec` 지속시간 조건은 breach 시작 시각을 메모리에 추적해 지원
  (gateway 단일 인스턴스 가정 — 재시작 시 추적 상태 초기화, 기존 idCache 등과 동일한 한계)
- reactive/proactive/optimization 분류 완료: `alarm_policy.tier`를 그대로 `alarm_log.tier`에 반영
- alarm action(ack/snooze/resolve/note) 완료: `packages/contracts/src/alarmLifecycle.ts` 상태 머신
  (command lifecycle.ts와 동일 패턴) + `packages/db/src/alarm-service.ts`가 전이·alarm_action·audit_log를
  한 transaction으로 처리. USER는 ack/snooze만, MONITOR/HITL_APPROVER는 resolve/note까지(SRS 2.2/2.3)
- escalation rule 완료: gateway가 5초 주기로 `sweepDueEscalations()` 실행 — 알람별로 아직 발동하지 않은
  가장 낮은 레벨 중 `after_sec` 경과분만 처리(SNOOZED는 snooze 해제 후에만 대상), `escalated_level` 갱신
  + audit(`ESCALATE`)
- notification channel: `packages/notify` 신설 — **WEBHOOK만 실제 HTTP POST 발송**(5초 타임아웃, 채널별
  실패 격리). PUSH/EMAIL/SMS는 provider 미정(부록 A.2)이라 로그 스텁만 남김(사용자 확인 완료, 2026-07-10)
- 목록/단건 조회·조치는 area 스코프 적용(devices/spatial과 동일하게 `hasAreaAccess()` 재사용 — 최초로
  실사용됨)

완료 조건:
- 정책에 따라 alarm_log가 생성된다. 완료 — 동일 policy+device로 이미 열린 알람이 있으면 재발행하지
  않는다(`findOpenAlarm` 중복 억제, E2E로 확인)
- ack/snooze/resolve가 상태와 이력에 반영된다. 완료 — 불법 전이(예: 이미 ACK인데 재-ACK)는 409로 거부
- notification provider는 구현 전 사용자 결정 필요. 완료 — WEBHOOK만 구현하기로 결정(2026-07-10)

알려진 단순화(후속 필요):
- **Notification Channel / Escalation Rule에는 아직 API가 없다** — 이번 E2E 검증은 SQL로 직접
  channel/escalation_rule을 만들어 확인했다. Admin 화면에서 관리하려면 CRUD API 추가 필요
- **역할 기반 에스컬레이션 알림(`escalation_rule.notify_role`) 미구현** — 채널 지정(`notify_channel_id`)만
  실제 동작하고, role 지정은 로그 스텁만 남긴다(역할별 사용자 조회 + 채널 결정 로직 필요)
- **정책 캐시 갱신 지연** — gateway가 정책을 30초 주기로 캐시하므로, 정책 생성/비활성화가 최대 30초
  지연 반영된다
- **offline alarm(LWT 감지)은 이번 audit 강화 대상에서 제외** — `raiseOfflineAlarm`(기존 M2 경로)은
  policy 기반이 아니라 audit_log를 남기지 않는다. 새 policy 기반 RAISE/ESCALATE만 audit 남김(비대칭,
  일관성 개선은 후속)

### M10. Scheduler

상태: **완료(MVP)** (E2E 검증: ONE_TIME/GROUP 발화→command→audit, 2026-07-10)

작업:
- one-time/daily/weekly/monthly/cron 완료(`apps/scheduler/src/schedule-math.ts`, 순수함수 16개 테스트).
  event는 이벤트 소스가 SRS/PROJECT_RULES에 정의돼 있지 않아 제외(스킵, 후속 필요)
- distributed lock 완료: `SELECT ... FOR UPDATE SKIP LOCKED`로 scheduler row를 잠그고 짧은 트랜잭션 안에서
  due 판정 + claim(schedule_run 선기록)까지 끝낸 뒤 커밋 — 실제 MQTT 발행(네트워크 I/O)은 락 밖에서 수행
- missed schedule 처리 완료: 의도된 발화 시각보다 `MISSED_GRACE_MINUTES`(10분) 넘게 늦으면 발행 대신
  `SKIPPED`로 기록
- schedule_run 기록 완료: DEVICE 타깃은 1행, GROUP 타깃은 대상 기기 수만큼 각각 별도 행(스키마에 다중
  command_id를 담을 컬럼이 없어 이렇게 설계)
- command path 재사용 완료: `@smarthome/command-flow`의 `publishDeviceCommand`를 그대로 사용
  (actorType=SYSTEM, role=null — command-flow의 `PublishDeviceCommandInput.role`을 `Role | null`로 완화,
  MQTT User Properties의 Role은 필수라 null이면 "ADMIN"으로 폴백 — 스케줄러 설정 자체가 ADMIN 전용이라는
  근거)
- scheduler 변경 audit 완료: create/enable/disable/delete 모두 `audit_log`(target_type=SCHEDULER)

완료 조건:
- scheduler가 command를 발행하고 command/audit lifecycle을 재사용한다. 완료

알려진 단순화(후속 필요):
- **EVENT 트리거 미구현** — 이벤트 소스(기기 상태 변화? 알람 발생? 외부 웹훅?)가 SRS/PROJECT_RULES 어디에도
  정의돼 있지 않아 스킵. 구현 전 사용자 결정 필요
- **CRON은 라이브 E2E 미검증** — `schedule-math.test.ts`로 로직은 충분히 검증했지만(정상/이미 처리됨/
  잘못된 식), 실인프라에서 실제 cron 주기를 기다려 확인하지는 않았다(ONE_TIME/GROUP과 발행 파이프라인은
  동일하므로 위험은 낮다고 판단)
- **AREA 타깃 미지원** — `scheduler.target_type`은 DEVICE/GROUP/AREA를 허용하지만, AREA 대상 명령 발행은
  아직 없음(`resolveTargetDeviceIds`가 AREA를 만나면 빈 배열 반환 → FAILED로 기록)
- **schedule_run.command_id는 클레임 시점에 null** — FK가 command(command_id)를 가리켜야 해서, 클레임은
  null로 먼저 기록하고 발행 성공 후 backfill한다(E2E 중 FK 위반을 직접 발견해 수정한 설계)

### M11. AI/HITL

상태: 완료(안전 인프라, 2026-07-14) — 실제 ML/휴리스틱 모델(이상행동·에너지·외출/취침·위험예측)은
범위 밖(2026-07-14 사용자 결정, 아래 참고)

2026-07-14 사용자 결정:
- **Confidence 임계치 = 0.8**(보수적 — 실신뢰 모델이 없는 초기 단계라 대부분 승인을 거치게 함)
- **이번 라운드 구현 범위 = 안전 인프라만**: recommendation 저장·confidence/고위험 게이트·
  Approve/Reject·감사·학습데이터·승인대기열 화면까지. 실제 추천 생성 로직(ML/휴리스틱)은 미착수 —
  ADMIN이 테스트/데모용으로 직접 호출하는 생성 API/폼으로 대체
- **고위험 장치 게이트 = 이미 모델링된 것만**: 메인 차단기 성격의 감시장비(`device_role=
  MONITORING_EQUIPMENT`)만 게이트. 도어락·가스 차단은 이 시스템에 device_type 자체가 없어 대상에서
  제외(그런 기기가 실제로 온보딩되면 그때 추가)
- **targetType = DEVICE만 지원**: `ai_recommendation.command_id`가 단일 컬럼이라 GROUP/AREA 타깃의
  다중 명령 fan-out(스케줄러의 `schedule_run`처럼 명령마다 별도 행이 필요)을 이 스키마로 표현할 수
  없어 "전체 조명 제어" 같은 GROUP 대상은 후속 과제로 남김(부록 A.2 성격)

작업:
- recommendation 저장 — 완료(마이그레이션 0008 기존 스키마 그대로 사용, 신규 마이그레이션 불필요)
- confidence threshold — 완료(0.8, `apps/api/src/services/recommendations.service.ts`)
- high-risk device 목록 — 완료(위 결정대로 MONITORING_EQUIPMENT만)
- approve/reject endpoint — 완료(`POST /api/v1/recommendations/:id/decision`, ADMIN+HITL_APPROVER)
- 승인 후 command path 재사용 — 완료(`CommandsService.dispatchAsAi()`→`publishDeviceCommand`, actorType=AI)
- `hitl_decision`, `ai_training_sample` 저장 — 완료(`recordHitlDecisionInTx` 한 트랜잭션)

완료 조건:
- 저신뢰/고위험 추천은 승인 없이 실행되지 않는다. **완료** — `requiresHitl` 게이트 통과 못 하면
  `PENDING_APPROVAL`로 대기, Approve 없이는 `dispatchAsAi` 호출 경로 자체가 없음
- approve/reject가 모두 학습 데이터로 저장된다. **완료** — 결정마다 `ai_training_sample` 1행

완료된 작업 단위 (2026-07-14):
1. `packages/contracts/src/hitlLifecycle.ts` — 추천 상태 머신(PENDING_APPROVAL→APPROVED→EXECUTED,
   PENDING_APPROVAL→REJECTED/EXPIRED), command/alarm lifecycle과 동일 패턴으로 단일 소스화
2. `packages/db/src/ai-repository.ts` — `ai_recommendation` CRUD, `hitl_decision`/
   `ai_training_sample` insert. `packages/db/src/hitl-service.ts` —
   `recordHitlDecisionInTx`(상태 전이+hitl_decision+ai_training_sample+audit_log를 한 트랜잭션),
   `markRecommendationExecuted`(APPROVED→EXECUTED)
3. `apps/api/src/services/commands.service.ts`: `dispatchAsAi()` 추가 — HITL 승인(또는 자동승인)
   후 실제 제어 발행 전용, actorType 항상 `AI`로 고정(PROJECT_RULES §9), role은 null(스케줄러의
   SYSTEM 액터와 동일 패턴 — MQTT User Property Role은 command-flow가 ADMIN으로 폴백)
4. `apps/api/src/services/recommendations.service.ts` + `routes/recommendations.controller.ts` —
   `POST /api/v1/recommendations`(ADMIN, 게이트 계산 후 즉시실행 또는 대기열), `GET
   /api/v1/recommendations`(+`?status=`), `GET /:id`, `POST /:id/decision`(ADMIN+HITL_APPROVER)
5. `apps/web`: `RecommendationsAdmin.tsx`(신규) — 추천 생성 폼(유형/대상 기기/명령/confidence/
   모델버전) + 상태별 필터 목록 + `PENDING_APPROVAL` 행에 승인/거절 버튼(사유 입력 포함).
   `App.tsx`에 `recommendations` view 추가, ADMIN 전용 네비게이션 + HITL_APPROVER(비-ADMIN)
   전용 네비게이션을 별도로 노출(순수 승인자는 다른 Admin 화면을 볼 필요 없음)
6. `pnpm typecheck`(contracts/db/api/web 개별) 통과. 실인프라(Postgres/Mosquitto)가 이 세션
   진행 중 도커 종료로 내려가 있어 E2E 실행/브라우저 검증은 하지 못했다 — 다음 작업자가 인프라
   기동 후 생성→대기열→승인→실행, 생성→즉시실행(고신뢰+비고위험) 두 경로를 직접 확인할 것

알려진 단순화(후속 필요):
- **실제 AI 모델 없음** — `apps/ai-engine`은 여전히 스캐폴딩만 있다(`RecommendationType` 나열).
  이상행동/에너지/외출/취침/위험예측 실제 로직 구현은 완전히 별도 과제
- **GROUP/AREA 타깃 미지원** — "전체 조명 제어" 같은 예시를 실제로 표현하려면 `ai_recommendation`
  스키마에 다중 명령 bookkeeping이 필요(스케줄러의 `schedule_run` 패턴 재사용 검토)
- **도어락/가스 차단 미모델링** — 그런 device_type이 생기면 고위험 게이트 목록에 추가해야 함
- **EXPIRED 전이 미사용** — 상태 머신엔 있지만 실제로 타임아웃시켜 만료 처리하는 스윕 로직은
  없음(알람의 escalation sweep과 유사한 배경 작업이 필요 — 후속)
- **E2E 미검증** — 위 참고, 인프라 재기동 후 필수 확인

### M12. Device Onboarding / OTA

상태: 진행 중 (device credential 발급 + 실제 ESP32 펌웨어 완료, 2026-07-13. OTA는 미착수)

작업:
- device credential 발급/회수 — **발급 완료**(보드별 MQTT 계정, `provision:mqtt-auth` 스크립트). 회수
  (기기 폐기 시 자동 revoke)는 미구현
- simulator credential 적용 — 범위 변경: 시뮬레이터가 아니라 **실제 ESP32 보드**가 발급받은 계정을
  사용(아래 완료 단위 참고). `apps/device-simulator`와 백엔드 서비스는 공용 `svc-backend` 계정 유지
- OTA job 생성 — 미착수
- `ota_update` command 발행 — 미착수
- `ota_target` 상태 추적 — 미착수
- Admin 기기 등록/수정 **UI**는 [M16](#m16-admin-관리-화면-공간기기도면스케줄-관리-콘솔)으로 이동(2026-07-10) —
  이 마일스톤은 credential/OTA 백엔드에만 집중

완료 조건:
- 신규 device가 credential 기반으로 등록/연결된다. **완료** — ESP32 보드가 발급받은 계정으로 연결하는
  펌웨어까지 구현(컴파일 검증 완료, 실제 물리 하드웨어 현장 테스트는 미완료)
- OTA 명령과 결과가 audit/ota_target에 남는다. 미완료

완료된 작업 단위 (2026-07-13):
1. `esp32/` PlatformIO 프로젝트 신설 — ESP32 DevKit + Arduino, 릴레이 보드(디지털아웃 10채널) 전등
   제어 펌웨어. `packages/db/src/seed-esp32-sample.ts`가 심은 device 모델과 1:1 대응("1f-esp32-a" 보드)
2. 보드 1대 = MQTT 연결 1개(clientId=보드 코드, LWT=보드 자신의 state 토픽), 채널(전등) 10개는 같은
   연결로 서로 다른 topic 세트에 개별 발행/구독. 보드가 죽으면 서버측 `cascadeChildrenOffline`이 채널을
   자동 OFFLINE 처리하므로 펌웨어는 자기 LWT만 신경 쓰면 됨
3. MQTT 3.1.1(PubSubClient) 사용 — 서버의 MQTT5 User Properties는 감사 메타데이터 용도라 기기가 읽거나
   되실 필요 없어 프로토콜 계약을 그대로 만족(근거는 `esp32/README.md`에 명시)
4. Wi-Fi 비밀번호 등 보드별 비밀값이 담기는 `include/config.h`는 `.gitignore` 대상, `include/config.example.h`
   템플릿만 커밋
5. `pio run` 컴파일 검증 완료(경고/에러 없음, RAM 14.7%·Flash 58.6%)
6. `packages/db/src/seed-esp32-sample.ts` — 5층 건물, 층당 ESP32 보드 2대, 보드당 디지털아웃 10채널
   (전등) 샘플. 보드는 `device_role='MONITORING_EQUIPMENT'`로 분전반(Area.kind='PANEL')에, 채널은
   `device_role='SENSOR'`+`parent_device_id`로 보드에 연결, 실제 방(Area.kind='ROOM') 4곳에 순환 배정해
   한 보드가 여러 지역의 전등을 섞어서 담당하는 배선을 표현
7. `packages/db`: `cascadeChildrenOffline()` 추가 — 감시장비(보드)가 OFFLINE 전이되면
   `parent_device_id`로 연결된 하위 채널도 함께 OFFLINE 처리. `apps/gateway`가 상태 변경마다 호출하고,
   실제로 바뀐 자식마다 개별 오프라인과 동일하게 realtime 이벤트·알람을 남기도록 연결. MQTT로 보드
   OFFLINE을 재현해 10개 채널 전부 캐스케이드되는 것과 알람 10건이 정상 발생하는 것을 확인
8. MQTT 계정/ACL 발급 자체는 [M13](#m13-운영-보안)에 기록(같은 트랙, 보안 마일스톤 쪽에 상세 있음)

완료된 작업 단위 — 가상/실기기 구분(`device.simulated`, 2026-07-14):

배경: 이 시스템은 기기가 실제로 MQTT에 붙어 응답해야 상태가 존재한다 — 실기기가 하나도 없으면
개발/시연 자체가 어렵다(사용자 요청 배경). `device-simulator`의 `MockResponder`(`SIM_MOCK_ALL`)가
이미 "실기기 없이 전부 가상으로 개발/시연"은 지원했지만, DB를 전혀 보지 않고 브로커의 모든 기기
`cmd`에 무조건 응답해 **실기기와 가상 기기를 섞어 쓸 수 없었다**(둘 다 같은 기기의 retained
state를 발행하면 경쟁 상태 발생). ESP32처럼 실기기가 하나씩 배포되는 상황을 지원하려면 "이
기기는 이제 실기기가 맡았다"를 표시할 방법이 필요했다.

1. 마이그레이션 0023 — `device.simulated boolean NOT NULL DEFAULT true`. UNS 토픽(`buildTopic()`)은
   전혀 바꾸지 않는다 — 순수 메타데이터로, "누가 이 기기의 cmd에 응답할 자격이 있는가"만 가른다
   (토픽을 가상/실기기별로 분기하는 방안은 검토 후 기각 — Area 권한 와일드카드·도면 마커·그룹·
   알람 정책이 전부 "한 자리에 기기 하나" 전제라 이중 관리 부담만 커짐)
2. `packages/db`: `device-repository.ts`(`updateDeviceSimulated`, `listSimulatedDeviceCodes`),
   `spatial-repository.ts`(`DeviceListItem.simulated`) — 기존 `monitoring_visible`/`enabled`
   (0021)와 동일한 배선 패턴 재사용
3. `apps/api`: `PATCH /api/v1/devices/:id/simulated`(ADMIN 전용, `DEVICE_SIMULATED_UPDATE` audit) —
   `setMonitoring`과 동일 패턴이지만 관제 화면 노출 여부와는 무관해 별도 엔드포인트로 분리
4. `apps/device-simulator`: `@smarthome/db` 의존성 추가(기존엔 순수 MQTT 클라이언트로 DB 접근
   없었음 — `MockResponder`는 데모 편의 도구라는 성격상 예외적으로 허용). `MockResponder`가 30초
   주기로 `simulated=true`인 device.code 목록을 캐시하고, 그 목록에 없는(=실기기가 맡은) 기기의
   cmd는 건드리지 않는다. DB 조회 실패 시 fail-open(이전 목록 유지, 최초 조회 전엔 전부 응답)해
   DB 없는 순수 MQTT 데모 환경도 그대로 지원
5. `apps/web`: `DeviceAdmin.tsx`(가상/실기기 배지 + 전환 버튼), `FloorMap.tsx`(마커에 보라 점선
   테두리로 가상 기기 표시 — 알람 링과 반지름을 달리해 동시 표시돼도 안 겹침), `DeviceDrawer.tsx`
   (가상/실기기 배지)
6. 실인프라(Postgres) 마이그레이션 적용 확인 — 기존 기기 117대 전부 `simulated=true`로 채워짐
   (실기기가 아직 하나도 배포되지 않은 현재 상태와 일치)
7. `pnpm typecheck`+`build`(db/api/web/device-simulator 개별) 통과 확인. 전체 워크스페이스
   `turbo run`은 이 세션 환경의 시스템 메모리 부족으로 개별 패키지 단위로 나눠 검증

사용 흐름: 실기기를 연결하면 `PATCH .../simulated { simulated: false }`(Admin 화면의 "실기기로
전환" 버튼) 한 번으로 `MockResponder`가 그 기기를 더 이상 건드리지 않는다 — 토픽/Area 배정/도면
위치/그룹/알람 정책은 전부 그대로 유지된다(마이그레이션·재배선 불필요).

알려진 단순화(후속 필요):
- credential 회수(기기 폐기 시 자동 revoke) 미구현
- OTA(job 생성/명령/상태 추적) 전체가 미착수
- 실제 물리 ESP32 하드웨어로 현장 배선·전원 테스트는 미완료 — 이번엔 `pio run` 컴파일 검증까지만
- `device.simulated`를 실기기로 전환해도 `apps/device-simulator`의 단일 기기 모드(`VirtualDevice`,
  thermostat-01 하드코딩)는 이 플래그를 보지 않는다 — 그 경로는 애초에 특정 기기 하나만 흉내내는
  전용 테스트 도구라 영향 범위 밖(향후 fleet 확장 시 함께 정리)

### M13. 운영 보안

상태: 진행 중 (Mosquitto auth/ACL 완료 2026-07-13, TLS **설정 준비** 완료 2026-07-14 —
실배포 검증은 미완료)

작업:
- Mosquitto TLS 설정 — **설정 완료(2026-07-14)**: `infra/mosquitto/mosquitto.prod.conf`(mqtts 8883,
  wss 9002, 평문 리스너 없음). 실제 프로덕션 호스트에서 기동 검증은 미완료
- WSS/mqtts only — 위와 동일. `apps/api`도 `TLS_CERT_FILE`/`TLS_KEY_FILE` 둘 다 있으면 https/wss로
  기동(설정 완료, 실배포 미검증)
- auth/ACL plugin 결정 및 연동 — **완료(2026-07-13)**: `allow_anonymous false` +
  password_file/acl_file, 보드별 계정 발급 스크립트(아래 완료 단위 참고)
- service API key 또는 mTLS — 서비스 간 별도 HTTP 호출 자체가 없어(전부 MQTT/DB로만 통신)
  기존 공용 계정(`svc-backend`, 비밀번호 기반)을 API Key로 간주하고 TLS로 전송만 암호화하는
  쪽으로 정리(2026-07-14 결정, → PROJECT_RULES 부록 A.1). 계정을 서비스별로 쪼개는 mTLS는
  하지 않기로 함(대상이 없음)
- `.env.example` 정리 — 완료(신규 인증 흐름 + TLS 변수 반영)

완료 조건:
- dev-only 평문 포트와 production TLS 구성이 명확히 분리된다. **설정 분리 완료** —
  `docker-compose.dev.yml`(평문)과 `docker-compose.prod.yml`+`mosquitto.prod.conf`(TLS만) 별도
  파일. 실제 프로덕션 인프라에서의 기동 검증은 배포 인프라 확정 후 진행
- 사용자/기기별 MQTT ACL이 적용된다. **완료** — 보드(감시장비)별 계정+ACL로 자기 자신과 하위 채널
  topic만 허용. 사용자(웹 클라이언트)는 MQTT를 직접 쓰지 않고 WS 브리지(M7)를 경유하므로 해당 없음

완료된 작업 단위 (2026-07-13, MQTT 인증/ACL):
1. `infra/mosquitto/mosquitto.conf` — `allow_anonymous false`, password_file/acl_file 지정.
   `infra/docker-compose.dev.yml` 마운트를 읽기쓰기로 전환(파일 생성 가능해야 함), 생성물(passwd/acl)은
   `infra/mosquitto/.gitignore`로 커밋 대상에서 제외
2. `packages/db/src/provision-mqtt-auth.ts`(`provision:mqtt-auth` 스크립트) — 감시장비(ESP32 보드)마다
   별도 계정을 발급해 `device_credential`에 해시로 저장하고, ACL로 그 보드 자신 + 그 보드에 딸린 채널
   topic만 허용. api/gateway/scheduler/device-simulator는 공용 계정(`svc-backend`, `enterprise/#` 전체)
   사용. 비밀번호는 발급 시 콘솔에 1회만 출력되고 `.env`에 자동 기록
3. `packages/mqtt`의 `connect()` 한 곳에서 `MQTT_USERNAME`/`MQTT_PASSWORD`를 자동으로 실어주도록 해서
   6개 호출부(api/gateway/scheduler/device-simulator 전부)를 개별로 고치지 않아도 되게 함
4. E2E(실인프라): 정상 발행/거부(오탐 비밀번호) 확인. 보드 A 계정으로 보드 B 토픽에 몰래 쓰기를 시도해
   브로커가 조용히 버리는 것(retained 값 불변)을 확인. 인증 켠 상태에서 명령 왕복(turn_on→ack→
   SUCCEEDED) 전체 경로도 재검증

완료된 작업 단위 (2026-07-14, TLS 설정 준비 — 상세는 [docs/tls-deployment.md](tls-deployment.md)):
1. `infra/tls/generate-certs.sh` — 자체 서명 사설 CA + Mosquitto/API 서버 인증서 생성 스크립트.
   실제로 실행해 CA 체인 검증(`openssl verify`)과 SAN(DNS/IP 올바른 태깅) 확인 완료. 산출물은
   `infra/tls/out/`(`.gitignore` 대상, 커밋 금지)
2. `infra/mosquitto/mosquitto.prod.conf` — mqtts(8883)/wss(9002)만 열고 평문 리스너 없음.
   `infra/docker-compose.prod.yml` 신설(`docker compose config`로 문법 검증 완료, 실제 기동은
   미검증) — healthcheck는 `provision:mqtt-auth`가 발급한 `svc-backend` 계정 재사용
3. `packages/mqtt`의 `connect()`에 `MQTT_CA_FILE` 지원 추가 — 있으면 파일을 읽어 `ca` 옵션으로
   자동 적용(기존 `MQTT_USERNAME`/`PASSWORD` 자동 적용과 동일한 단일 지점 패턴)
4. `apps/api/src/index.ts` — `TLS_CERT_FILE`/`TLS_KEY_FILE` 둘 다 있으면 `NestFactory.create`에
   `httpsOptions`를 넘겨 https.Server로 기동. `RealtimeWsServer`가 그 서버에 attach되므로
   `/ws/realtime`도 자동으로 wss가 됨(둘 중 하나만 있으면 무시하고 기존처럼 http로 기동 — dev 영향 없음)
5. `esp32/` — `MQTT_USE_TLS` 컴파일 스위치 추가(`config.example.h`). true면 `WiFiClientSecure` +
   `setCACert()`로 mqtts(8883) 접속, NTP 동기화 완료까지 대기(인증서 유효기간 검증에 실제 시각
   필요) 후 핸드셰이크. 기본값 false — 기존 평문 경로는 그대로
6. `PROJECT_RULES.md` 부록 A.1에 TLS/인증서 전략 결정 기록(자체 서명 사설 CA, 프로덕션 설정만
   우선 준비, ESP32도 TLS 대상 포함)
7. `pnpm typecheck`+`build` 전체 통과(21/21 태스크) — `test`는 이 세션 환경의 시스템 메모리
   부족(가용 RAM ~2GB)으로 기존(무관한) `contracts` 테스트조차 워커 OOM이 나 재검증 못 함(코드
   변경과 무관한 환경 제약)

알려진 단순화(후속 필요):
- **프로덕션 실배포 미검증** — 배포 인프라(K8s/VM 등, 부록 A.2)가 미정이라 이번 라운드는
  "설정 준비"까지다. 실제 호스트에서 mqtts/wss 핸드셰이크 성공 여부, `docker-compose.prod.yml`
  기동, healthcheck 동작을 검증해야 한다
- **ESP32 TLS 컴파일 미검증** — 이 세션 환경에 PlatformIO CLI가 없어 `MQTT_USE_TLS=true` 경로는
  `pio run` 컴파일조차 못 했다(기본값 false 경로는 기존 검증 그대로 유효)
- **인증서 로테이션 자동화 없음** — `generate-certs.sh` 재실행 시 새 CA/인증서를 만들고, 기존
  클라이언트에는 새 `ca.crt`를 수동 재배포해야 한다
- **Redis는 TLS 대상 밖** — §5.1이 "MQTT/HTTP"로 범위를 한정해 제외. 대신 프로덕션 compose는
  호스트 포트 노출을 없애 네트워크 경계로 접근을 좁힘

### M14. 테스트/검증 체계

상태: 진행 중 (CI 파이프라인 완료 2026-07-14 — 나머지는 미착수)

2026-07-14 착수 전 조사에서 확인한 실제 상태(그동안 "미완료"로만 표시돼 있었지만 세부는 불명확했음):
- **유닛 테스트는 이미 상당히 있었다** — 22개 파일 약 124케이스(`packages/contracts` 7파일,
  `packages/db` 10파일, `packages/auth`/`notify`/`command-flow`, `apps/scheduler`의
  `schedule-math.test.ts`). 다만 `packages/db` 쪽은 전부 손수 만든 in-memory fake `QueryExecutor`
  기준이라 실제 Postgres는 한 번도 쓰지 않는다 — "unit"이지 "integration"이 아니다.
- **gateway/device-simulator는 테스트가 전혀 없다** — 로직이 진입점 스크립트(`apps/gateway/src/index.ts`
  564줄 등)에 그대로 인라인돼 있어 핸들러가 별도 함수로 분리·export되지 않았다. 라이브 MQTT/DB
  연결 없이는 유닛테스트 자체가 불가능한 구조 — 테스트를 추가하려면 먼저 리팩터링이 필요하다.
- **Playwright 미도입** — `scripts/m16-device-e2e.cjs`는 `@playwright/test`가 아니라 playwright
  라이브러리를 직접 불러 쓰는 임시 Node 스크립트, `playwright.config.ts`도 없다.
- **testcontainers 미도입** — 어떤 `package.json`에도 없다.
- `docs/test-strategy.md`(2026-07-09)에 테스트 피라미드·PR 게이트 정책이 이미 합의돼 있었지만
  구현은 거의 0%였다.

2026-07-14 사용자 결정: 위 항목 중 **CI 파이프라인부터** 진행(gateway 리팩터링·testcontainers는
후속 — 특히 이 세션은 메모리 문제로 Docker를 꺼둔 상태라 testcontainers 검증 자체가 지금 어려움).

작업:
- repository unit test — 기존에 이미 있었음(위 참고). 이번 라운드에서 추가 작성 없음
- gateway integration test — 미착수(먼저 `apps/gateway/src/index.ts` 핸들러 분리 필요)
- Mosquitto + Postgres testcontainers — 미착수(Docker 꺼진 상태, 후속)
- simulator E2E — 미착수
- Playwright dashboard test — 미착수(`@playwright/test` 자체가 미설치)
- command/audit 불변식 테스트 — 기존 `command-service.test.ts`(9케이스, fake DB 기준)가 정상/불법
  전이/중복 commandId는 커버. 타임아웃 경로·실제 QoS/retained/LWT는 여전히 미검증
- QoS/retained/LWT 테스트 — 미착수(라이브 브로커 필요)
- **CI 파이프라인 — 완료(2026-07-14)**: `.github/workflows/ci.yml` 신설, push(main)/PR마다
  `pnpm install --frozen-lockfile` → `pnpm run lint` → `pnpm run build` → `pnpm run typecheck` →
  `pnpm run test`(기존 124케이스 전부 포함) 자동 실행. `docs/test-strategy.md` §9 "PR 게이트:
  lint+typecheck+unit+contract+integration"의 lint/typecheck/unit/contract까지 구현 —
  integration은 testcontainers 도입 후 별도 워크플로로 추가 예정
- **ESLint 최초 도입 — 완료(2026-07-14)**: 루트 `eslint.config.mjs`(flat config) 하나로 모노레포
  전체를 `eslint .`로 검사(패키지별 lint 스크립트 불필요 — pnpm workspace 하위마다 eslint
  의존성을 추가할 필요가 없어짐). 최초 도입이라 실제 버그를 잡는 규칙(미사용 변수,
  react-hooks 의존성 배열) 위주로 최소 구성, 스타일 규칙(포매터)은 아직 없음. 처음 돌려서
  나온 지적 3건 모두 실제로 고침(빈 규칙 끄기로 회피하지 않음): `FloorMap.tsx`의
  `useMemo` 의존성 누락(`areaMatch`를 `useCallback`으로 안정화해 해결), `scripts/*.cjs`가
  `require()`를 쓰는 걸 오탐하던 규칙은 `.cjs` 파일에 한해 끔(CommonJS 확장자이므로 정상 관용구)

완료 조건:
- PROJECT_RULES 위반이 테스트에서 잡힌다. 부분 완료 — 기존 유닛테스트+lint가 잡는 범위(상태전이·
  payload 스키마·react-hooks 등)는 CI에서 자동 실행되지만, QoS/retained/LWT/HITL 게이트 등 라이브
  인프라가 필요한 불변식은 여전히 수동 검증에 의존
- command/audit 경로는 정상/실패/타임아웃/중복 케이스를 모두 검증한다. 부분 완료 — 정상/불법전이/
  중복은 fake DB 유닛테스트로, 타임아웃은 실인프라 수동 E2E로만 검증됨(자동화 안 됨)

알려진 단순화(후속 필요):
- gateway 핸들러를 함수로 분리해야 유닛테스트를 붙일 수 있다(현재는 진입점 스크립트에 인라인)
- testcontainers 도입 시 `packages/db`의 fake `QueryExecutor` 기반 테스트를 실제 Postgres 대상
  통합 테스트로 확장할지, 유닛(fake)과 통합(real)을 층으로 나눠 공존시킬지 결정 필요
- Playwright 정식 도입 + `scripts/m16-device-e2e.cjs`류 임시 스크립트의 정식 test spec 전환
- ESLint 규칙은 최소 구성 — 포매터(Prettier 등) 도입, 규칙 강화(예: `no-explicit-any` 다시 켜기)는
  후속 판단 필요

### M15. 성능/운영

상태: 미완료

작업:
- telemetry batch tuning
- TimescaleDB retention policy
- continuous aggregate
- command latency metric
- alarm propagation metric
- load simulator mode
- Prometheus metrics

완료 조건:
- SRS 성능 목표를 측정할 수 있다.
- 병목이 command, telemetry, alarm 별로 구분된다.

---

### M16. Admin 관리 화면 (공간/기기/도면/스케줄 관리 콘솔)

상태: **완료** (5개 영역 모두 구현·실인프라·브라우저 E2E 검증 완료, 2026-07-10 신설 —
사용자 요청: 기기 등록/설정, 지역 관리, 도면 관리, 시스템 기본정보
관리, 스케줄/예약 등록 화면 추가)

배경: M8 Web Dashboard는 실시간 관제 화면만 만들었고(§303 "MVP 범위 밖으로 의도적으로 제외한 것"),
SRS 2.1.1(공간 관리)·2.1.2(기기 관리)·2.1.4(자동화 관리) 요구사항을 채우는 등록/수정 UI가 하나도 없다.
enterprise/site/building/area/floor_map/device는 전부 `packages/db/src/seed.ts`의 raw SQL로만
만들어져 있고, scheduler만 M10에서 이미 CRUD API가 갖춰져 있다(UI만 없음). ADMIN 전용 콘솔로 신설한다.

2026-07-10 사용자 결정(→ PROJECT_RULES.md 부록 A.1 반영):
- 평면도 이미지 저장 = **로컬 파일시스템** (S3/오브젝트 스토리지·DB bytea 아님)
- 시스템 기본정보 관리 범위 = **Site/Building 이름 수정만** (생성/삭제 등 조직 계층 CRUD는 제외 —
  enterprise는 단일 고정, 멀티테넌시는 SRS 7의 후속 과제)

작업:
1. **기기 등록/설정** (SRS 2.1.2)
   - 기기 목록/등록/수정 폼(이름·category·제조사/모델·Area 매핑·좌표)
   - 연결 프로토콜 설정 폼(기존 `PATCH /api/v1/devices/:id/connection` 재사용, 프로토콜 선택에 따라
     입력 필드 동적 전환 — TCP_IP/SERIAL/MODBUS_TCP/MODBUS_RTU/ZIGBEE/ZWAVE)
   - 백엔드: Device 생성/수정/소프트 폐기 API, `buildDeviceBase()` 기반 토픽 생성, 모든 변경 audit
2. **지역(Area) 관리** (SRS 2.1.1)
   - Area 생성/수정/삭제, Polygon 편집(Floor Map 캔버스 위에 드로잉 — M8 편집 모드의 좌표계 재사용)
   - 백엔드: Area CRUD API(ADMIN, 모든 변경 audit)
3. **도면(Floor Map) 관리** — **완료(2026-07-10)** (SRS 2.1.1)
   - 평면도 이미지 업로드(로컬 파일시스템), 스케일(m/px) 지정, Floor↔FloorMap 연결/교체
   - 백엔드: 이미지 업로드 엔드포인트(multipart, apps/api가 정적 서빙) + `floor_map`
     insert/update API
4. **시스템 기본정보 관리** — **완료(2026-07-10)** (신규 범위 정의)
   - Site/Building 이름 수정 폼(생성/삭제 제외 — 위 결정 참고)
   - 백엔드: `GET/PATCH /api/v1/spatial/sites(/:id)`, `GET/PATCH /api/v1/spatial/buildings(/:id)`
     (이름만, ADMIN 전용, `SITE_UPDATE_NAME`/`BUILDING_UPDATE_NAME` audit)
5. **스케줄/예약 등록 화면** — **완료(2026-07-10)** (SRS 2.1.4, 백엔드는 M10에서 이미 완료)
   - 스케줄 목록/생성/활성화 토글/삭제 폼(ONE_TIME/DAILY/WEEKLY/MONTHLY/CRON, JSON payload 입력,
     DEVICE/GROUP/AREA 타깃 선택), 실행 이력(`schedule_run`) 조회
   - 백엔드 이미 존재: `GET/POST /api/v1/schedulers`, `PATCH :id/enabled`, `DELETE :id`,
     `GET :id/runs` — UI만 만들면 됐다

완료 조건:
- ADMIN이 위 5개 영역을 UI에서 등록/수정할 수 있다(기기/지역/도면/Site·Building 기본정보/스케줄).
  **5개 관리 영역 구현 및 실인프라·브라우저 E2E 검증 완료.**
- 모든 변경이 Audit_Log에 기록된다(CLAUDE.md 필수 규칙 — 기존 command/alarm/scheduler와 동일 패턴).
  스케줄러·시스템 기본정보·도면은 확인 완료(아래 E2E 참고).
- 지역/도면 편집은 M8 편집 모드(Konva 좌표계·`dragBoundFunc` 클램프)와 정합적이다. 도면은 완료(아래
  참고). Area(Polygon) 편집도 E2E 검증 완료.
- 이미지 업로드는 로컬 파일시스템에 저장되고 재기동 후에도 `floor_map.image_url`로 정상 서빙된다.
  완료 — E2E로 확인(아래 참고).

완료된 작업 단위 — 기기 등록/설정(2026-07-10):
1. `POST /api/v1/devices`, `PATCH /:id`, `PATCH /:id/connection`, `PATCH /:id/decommission` 구현.
   토픽은 Area의 canonical slug 경로와 `buildDeviceBase()`로 서버가 생성하고, 삭제는 이력 보존을 위해
   `DECOMMISSIONED` 소프트 전이로 제한
2. `DeviceAdmin`/`ConnectionProtocolFields` — 기기 생성·인라인 수정·프로토콜별 연결 설정·폐기 UI
3. 기기/공간 변경과 audit를 동일 transaction으로 묶고, 폐기된 기기의 수정·연결 변경·재폐기는 409로 차단
4. `scripts/m16-device-e2e.cjs` 추가 — 로그인부터 생성/토픽/수정/연결/폐기/버튼 비활성화를 재실행 가능하게 검증
5. Playwright E2E 중 저장 후 목록을 재조회하지 않아 수정 이름이 즉시 반영되지 않는 결함을 재현·수정
6. 실제 DB에서 `DEVICE_CREATE`→`DEVICE_UPDATE`→`DEVICE_CONNECTION_UPDATE`→`DEVICE_DECOMMISSION`
   audit 4행이 모두 `SUCCEEDED`임을 확인. 폐기 후 수정 API는 409 확인
7. seed의 외부 placeholder 도면(`https://placehold.co/800x600`)은 제한된 테스트 네트워크에서만 로드 실패;
   M16 API/UI 요청 실패나 브라우저 예외는 없음

완료된 작업 단위 — 스케줄/예약 등록 화면(2026-07-10):
1. `apps/web/src/lib/types.ts`: `SchedulerRecord`/`CreateSchedulerRequest`/`ScheduleRunRecord` 뷰 타입 추가
   (API의 camelCase 응답을 그대로 반영, `packages/contracts`의 `TargetType`/`ScheduleType`/
   `ScheduleRunStatus` enum 재사용)
2. `apps/web/src/lib/api.ts`: `listSchedulers`/`createScheduler`/`setSchedulerEnabled`/`deleteScheduler`/
   `getSchedulerRuns` 추가 — 기존 `authedJson` 패턴 그대로 재사용
3. `apps/web/src/components/SchedulerAdmin.tsx`(신규): 목록 테이블(이름/대상/일정 요약/명령/활성 토글/
   이력·삭제 버튼) + 생성 폼(반복 방식에 따라 입력 필드 동적 전환 — ONE_TIME은 datetime-local,
   DAILY/WEEKLY/MONTHLY는 시각(UTC) 입력 + WEEKLY 요일 다중선택/MONTHLY 일자, CRON은 cron 식 텍스트,
   대상 종류 DEVICE 선택 시 기기 드롭다운(GROUP/AREA는 ID 직접 입력 — 프런트에 Group/Area 목록 API가
   아직 없어 임시)) + payload(command 필수 + args JSON 선택)
4. `App.tsx`: 최상위 `view: "map" | "schedulers"` state 추가, ADMIN 전용 네비게이션 버튼으로 전환(기존
   실행/편집 모드 토글과 동일한 `mode-toggle` 스타일 재사용). 라우터 없이(이 프로젝트는 React Router
   미사용) 기존 로컬 view-switch 관례를 그대로 따름
5. E2E(실인프라, Playwright + 실제 Postgres/Redis/Mosquitto, 2026-07-10): 로그인 → 스케줄러 화면 전환 →
   ONE_TIME 스케줄 생성(대상: 실제 기기, 명령: turn_on) → 목록에 반영 확인 → 활성 토글 OFF → 실행 이력
   조회(빈 목록 정상 표시) → 삭제. 콘솔 에러 0건. `audit_log`에 `CREATE_SCHEDULER`→`DISABLE_SCHEDULER`→
   `DELETE_SCHEDULER` 3건 순서대로 기록됨을 SQL로 직접 확인
6. `pnpm typecheck && pnpm build && pnpm test` 전체 통과(21/21 태스크)

알려진 단순화(후속 필요):
- GROUP/AREA 타깃은 ID를 직접 입력해야 한다(프런트에 그룹/지역 목록 조회 API 연동이 없음 — 이번
  M16 나머지 항목(지역 관리)과 함께 개선 여지)
- 큰 번들 경고(524KB) 지속 — M15 성능 튜닝과 함께 코드 스플리팅 예정(M8 때부터 알려진 이슈)

완료된 작업 단위 — 시스템 기본정보 관리(2026-07-10):
1. `packages/db/src/spatial-repository.ts`: `SiteRecord`/`BuildingRecord` + `listSites`/`updateSiteName`/
   `listBuildings`/`updateBuildingName` 추가(이름만 갱신하는 단순 UPDATE, slug/계층 불변)
2. `apps/api`: `SpatialService`에 `listSites`/`updateSiteName`/`listBuildings`/`updateBuildingName`
   추가(변경 전후 이름을 `reason`에 남겨 `SITE_UPDATE_NAME`/`BUILDING_UPDATE_NAME` audit), 빈 이름은
   400. `SpatialController`에 `GET/PATCH sites(/:id)`, `GET/PATCH buildings(/:id)` 추가(ADMIN 전용)
3. `apps/web`: `SystemInfoAdmin.tsx`(신규) — Site/Building 테이블 + 인라인 수정(수정→입력→저장/취소).
   `App.tsx`에 세 번째 view(`"systemInfo"`) 추가, 헤더에 "시스템 정보" 버튼(ADMIN 전용)
4. E2E(실인프라, Playwright, 2026-07-10): 로그인 → 시스템 정보 화면 → Site 이름 수정("Site 1" →
   "Site 1 (수정됨)") → 목록 반영 확인 → 원복. 콘솔 에러 0건. `audit_log`에 `SITE_UPDATE_NAME` 2건
   (수정→원복) 순서대로 기록됨을 SQL로 확인
5. `pnpm typecheck && pnpm build && pnpm test` 전체 통과(21/21)

완료된 작업 단위 — 도면(Floor Map) 관리(2026-07-10):
1. `packages/db/src/spatial-repository.ts`: `FloorMapRecord` + `insertFloorMap`/`updateFloorMapScale`/
   `setFloorFloorMap` 추가
2. `apps/api/src/config/uploads.ts`(신규): 업로드 로컬 경로 단일 소스(`UPLOADS_ROOT`/`FLOOR_MAPS_DIR`,
   `import.meta.url` 기준 — cwd에 의존하지 않음) + `ensureFloorMapsDir()`
3. `apps/api/src/index.ts`: `NestExpressApplication` + `useStaticAssets(UPLOADS_ROOT, {prefix:"/uploads"})`로
   업로드 이미지를 `/uploads/floor-maps/<uuid>.<ext>` 경로로 정적 서빙
4. `apps/api/src/routes/spatial.controller.ts`: `POST floors/:id/floor-map`(multipart, `FileInterceptor`
   + `diskStorage`, 파일명은 `randomUUID()` + 원본 확장자, png/jpg/jpeg/webp만 허용, MIME·파일 시그니처
   검증, 10MB 제한),
   `PATCH floor-maps/:id`(스케일만 변경). 이미지 픽셀 크기(width/height)는 서버가 파싱하지 않고
   프런트가 `<img>` onload로 읽은 실제 크기를 함께 전송(이미지 처리 라이브러리 의존성 회피)
5. `apps/api/src/services/spatial.service.ts`: `uploadFloorMap`/`updateFloorMapScale` — floor_map 생성
   + `floor.floor_map_id` 갱신을 하나의 흐름으로 처리, `FLOOR_MAP_UPLOAD`/`FLOOR_MAP_UPDATE_SCALE` audit
6. `apps/api` 의존성: `multer`(직접 dependency로 추가 — `@nestjs/platform-express`의 transitive
   의존이라 pnpm의 엄격한 링킹 아래서는 직접 import가 module-not-found로 실패해 명시적으로 추가 필요)
   + `@types/multer`(devDependency)
7. `apps/web`: `lib/api.ts`에 `apiAssetUrl()`(루트-상대 업로드 경로를 API_BASE로 절대화, seed의 절대
   URL placeholder는 그대로 통과), `uploadFloorMap()`/`updateFloorMapScale()` 추가. `rawFetch`가
   `FormData` body일 때 기본 `Content-Type: application/json` 강제를 건너뛰도록 수정(멀티파트
   boundary가 깨지는 문제 방지). `FloorMapAdmin.tsx`(신규) — 층별 미리보기/크기/스케일 입력/파일
   선택 테이블, 파일 선택 시 `<img>` onload로 실제 픽셀 크기를 읽어 업로드. `FloorMap.tsx`(기존
   실시간 관제 캔버스)도 `apiAssetUrl()`을 거치도록 수정(안 그러면 업로드된 이미지가 API 서버가
   아니라 Vite dev 서버 origin으로 잘못 요청됨). `App.tsx`에 네 번째 view(`"floorMaps"`) 추가
8. `.gitignore`에 `apps/api/uploads/` 추가(업로드 파일은 커밋 대상 아님)
9. E2E(실인프라, Playwright, 실제 PNG 파일 생성 후 업로드, 2026-07-10): 로그인 → 도면 관리 화면 →
   스케일 0.02 입력 → 400×300 테스트 이미지 업로드 → 목록에 미리보기·크기(400×300px) 반영 확인 →
   관제 화면 재진입(같은 세션, `overview`가 이미 메모리에 있어 갱신 안 됨 — 아래 "알려진 단순화" 참고)
   → 새로고침(재로그인) 후 관제 화면에서 실제로 새 이미지(400×300, 업로드한 색상)가 렌더링됨을
   스크린샷으로 확인. `audit_log`에 `FLOOR_MAP_UPLOAD` 1건 기록 확인, 디스크에 실제 파일 생성 확인.
   테스트 후 `pnpm --filter @smarthome/db run seed`로 원래 800×600 placeholder로 복원, 업로드 파일·
   audit_log·고아 floor_map row 정리
10. `pnpm typecheck && pnpm build && pnpm test` 전체 통과(21/21)

알려진 단순화(후속 필요):
- **관제 화면이 새 도면을 즉시 반영하지 않음** — `App.tsx`의 `overview` state는 `selectedFloorId`가
  바뀔 때만 재조회된다. 다른 화면(도면 관리)에서 업로드해도 관제 화면으로 돌아왔을 때 자동 갱신되지
  않고, 페이지를 새로고침하거나 층을 다시 선택해야 반영된다. 실시간 갱신이 필요하면 WS 이벤트에
  `floor.updated` 같은 타입을 추가하거나 view 전환 시 강제 재조회가 필요(후속)
- **도면 교체 시 기존 Area Polygon과 크기가 어긋날 수 있음** — Area의 polygon 좌표는 이전 도면
  크기 기준 절대 픽셀값으로 저장돼 있어, 더 작은/다른 비율의 새 도면으로 교체하면 일부 Area가
  캔버스 밖으로 벗어나 보일 수 있다(E2E에서 실제로 재현됨 — 800×600 기준이던 침실 Area가 400×300
  도면에서 보이지 않게 됨). Area 관리(M16 다음 단계)에서 Polygon도 함께 재조정하는 것을 권장
- **재업로드 시 이전 floor_map row/파일이 고아로 남음** — 삭제하지 않고 새 row를 추가 + floor 연결만
  교체한다(디스크 정리는 후속 필요, 다른 마일스톤의 "알려진 단순화"와 동일한 패턴)

---

## 5. 열린 결정 항목

`PROJECT_RULES.md` 부록 A.2 기준:

| 항목 | 현재 상태 | 구현 전 필요 결정 |
|---|---|---|
| Notification Channel provider | 미정 | push/email/SMS/webhook 중 우선 구현체 |
| AI 추천 엔진 배치/서빙 방식 | 미정 | batch, online serving, 외부 모델 여부 |
| 배포/인프라 | 미정 | K8s 여부, Mosquitto HA/브리징 여부 |

---

## 6. 다음 추천 작업

M6(Auth/RBAC audit 보강), M7(Realtime Dashboard Bridge), M8a(devices/spatial 목록 API), M8(Web
Dashboard MVP + 편집 모드 + 서버 상태 위젯), M9(Alarm Service MVP), M10(Scheduler MVP), WS 브로드캐스트
area 스코프 필터링(M7/M8 이월 부채)까지 완료됐다. 2026-07-13에는 M16 범위 밖에서 별도로 M12(ESP32 실기기
온보딩 — credential 발급 + 실제 펌웨어)와 M13(Mosquitto auth/ACL) 트랙을 진행해 각각 "진행 중"으로
전환됐고, 2026-07-14에 M13의 TLS **설정 준비**(mqtts/wss, 자체 서명 CA, ESP32 TLS 스위치), 기기
가상/실기기 구분(`device.simulated`), **M11 AI/HITL 안전 인프라**까지 마쳤다(상세는 각 마일스톤
섹션·§4 참고).

M13은 "설정은 끝났지만 실제 배포 인프라에서 검증되지 않은" 상태이고(배포 인프라 확정 전까지 더
진행해도 검증 불가), M11은 "안전 인프라는 끝났지만 실제 AI 모델이 없는" 상태다(ML/휴리스틱 자체가
전혀 다른 종류의 작업). 남은 후보:
1. **M11 실제 모델** — `apps/ai-engine`에 이상행동/에너지/외출/취침/위험예측 로직을 채운다.
   ML/데이터 파이프라인 성격이라 이 저장소의 다른 작업들과 스킬셋이 다르고, 학습 데이터
   자체도 아직 거의 없다(방금 인프라가 생겼을 뿐).
2. **배포 인프라 결정(부록 A.2)** — 정하면 M13(TLS 실배포 검증)·M15(운영/성능)를 동시에 구체화 가능.
   구현 작업이 아니라 사용자 결정이 선행돼야 하는 항목이다.
3. **M14 테스트/검증 체계** — 지금까지 쌓인 기능(M9~M13, M16 등)이 전부 수동 스크립트/Playwright
   개별 실행으로만 검증됐다. CI 편입 시점이 계속 늦어지고 있어 후순위로 밀릴수록 회귀 위험이 커진다.

셋 다 "지금 당장 사용자 결정 없이 코드로 진행 가능"하지는 않다(1은 스킬셋 문제, 2는 결정 필요,
3은 범위가 크다) — 다음 방향은 사용자와 상의 후 정한다.

이유(과거 기록, 여전히 유효):
- SRS/PROJECT_RULES에서 가장 강한 불변식은 "제어 명령은 audit 없이 실행될 수 없다"이다.
- API, Scheduler, AI/HITL은 모두 command path를 재사용해야 한다.
- command/audit transaction을 먼저 고정해야 이후 기능이 우회 경로를 만들지 않는다.

완료된 첫 작업 단위:
1. `packages/db/src/command-repository.ts` 추가
2. `packages/db/src/audit-repository.ts` 추가
3. `packages/db/src/command-service.ts` 추가
4. 정상/불법 전이/실패 reason code/중복 commandId 테스트 추가

완료된 MQTT/Redis 연동 작업 단위:
1. gateway에 command publish 함수 추가
2. gateway에 `/cmd/ack` 구독 및 `AckPayload` 처리 추가
3. ack 수신 시 `transitionCommandWithAudit()` 재사용
4. command publish 정책은 `CREATED -> PENDING -> MQTT publish -> IN_PROGRESS`로 확정
5. Redis dependency 및 연결 헬퍼 추가
6. `cmd:{commandId}` correlation state 저장
7. ack 수신 시 Redis/DB 상관 확인
8. timeout sweeper 구현

완료된 명령 경로 마감 작업 단위 (2026-07-09):
1. `packages/command-flow` 추출 — 발행/correlation 단일 소스, api·gateway 재배선
2. simulator M2 — `/cmd`→ack, 멱등성, 결함주입(noack/fail)
3. 명령 전체 E2E — 성공/멱등/타임아웃 3경로 + audit 4행 체인 DB 검증

완료된 M7 작업 단위 (2026-07-09):
1. contracts에 `RealtimeEvent`(discriminated union) + `REALTIME_CHANNEL` 추가
2. `packages/realtime` 신설 — Redis pub/sub publish/subscribe 단일 소스
3. gateway 3개 훅(state/offline-alarm/ack·timeout)에서 이벤트 발행
4. api `RealtimeWsServer`(`ws` 패키지, NestJS HTTP 서버 attach) — JWT 쿼리스트링 인증
5. E2E: WS 클라이언트가 `device.state`·`command.status` 이벤트 실시간 수신 확인

완료된 M8a 작업 단위 (2026-07-10):
1. api에 `GET /devices`(목록), `GET /spatial/floors`, `GET /spatial/floors/:id/overview` 추가
2. 목록형 API에도 area 스코프 조회 권한 적용 — JWT `topics`(ACL claim) 기준으로 ADMIN 외에는
   허가된 area/floor만 노출(리뷰에서 발견된 미스코프 이슈 수정)
3. `floor_map.image_url` UNIQUE 제약은 기존 마이그레이션 수정 대신 `0012` 신규 마이그레이션으로 분리
4. seed 보강 — Area 2개(폴리곤), 기기 3대, floor_map placeholder
5. `packages/db/src/spatial-repository.test.ts` 추가(6개)

완료된 M6 마감 작업 단위 (2026-07-10):
1. `AuthService.login/refresh/logout`에 감사 로그 추가 — 성공/실패 모두 기록
   (`insertAuditLog` 재사용, `commandId`/`sessionId`는 명령 수명주기 전용이라 auth 이벤트는 null)
2. E2E: 실인프라에서 로그인 성공/실패, refresh 성공/실패(형식오류·재사용), logout 확인 —
   `audit_log`에 8행 기대한 actor/target/status로 기록됨

완료된 M8 작업 단위 (2026-07-10):
1. `apps/web` Vite+React 부트스트랩 — 별도 tsconfig(bundler resolution), 로그인 화면·토큰 저장(localStorage)
2. `lib/api.ts` — fetch wrapper, 401 시 refresh 1회 재시도(동시 401 겹침 방지용 in-flight 공유 promise)
3. `lib/useRealtime.ts` — `/ws/realtime` 구독 훅, 4401(인증만료)은 재연결 없이 로그아웃 위임
4. `FloorMap`(Konva) — floor_map 배경, Area polygon, 기기 마커(상태색), wheel zoom + drag pan
5. `DeviceDrawer` — 상태 배지, ON/OFF 명령, 명령/감사/알람 통합 이력
6. `EventFeed` — 실시간 타임라인(최근 50개)
7. 선택된 기기는 id만 상태로 들고 `overview.devices`에서 매 렌더 파생 — 초기 구현에서 스냅샷을 별도
   상태로 들었다가 realtime 업데이트가 반영 안 되는 버그를 브라우저 E2E 중 발견해 수정
8. E2E(Playwright, 실인프라): 로그인→Floor Map→마커 클릭→Drawer ON/OFF→MQTT ack→SUCCEEDED→
   WS `device.state`/`command.status` 실시간 반영, 콘솔 에러 없음 확인

완료된 M9 작업 단위 (2026-07-10):
1. `packages/contracts/src/alarmLifecycle.ts` — 알람 상태 머신(RAISED→ACK/SNOOZED→RESOLVED),
   command lifecycle.ts와 동일 패턴으로 단일 소스화
2. `packages/db/src/alarm-repository.ts` — alarm_policy/notification_channel/escalation_rule/
   alarm_log/alarm_action CRUD, area 스코프용 topicPrefix 조인, `compareThreshold()`,
   에스컬레이션 후보 조회(`listDueEscalations`, 알람별 미발동 최저 레벨 1건만 반환)
3. `packages/db/src/alarm-service.ts` — ack/snooze/resolve/note 전이+alarm_action+audit_log를
   한 transaction으로(`recordAlarmActionInTx`), policy 위반 시 중복 억제 raise(`raiseAlarmFromPolicyInTx`),
   에스컬레이션 sweep(`sweepDueEscalations`, HTTP 발송은 tx 밖에서 호출부가 수행)
4. `packages/notify` 신설 — WEBHOOK 실제 HTTP POST(5초 타임아웃, 채널별 실패 격리), 나머지는 로그 스텁
5. gateway: 활성 policy 30초 캐시, telemetry 수신마다 threshold 평가(duration_sec 지속시간은
   메모리로 breach 시작 시각 추적), 5초 주기 에스컬레이션 sweep
6. api: `AlarmsController`(list/get/ack/snooze/resolve/note, area 스코프 — `hasAreaAccess()` 최초 실사용)
   + `AlarmPoliciesController`(ADMIN 전용 CRUD, 정책 변경도 audit)
7. E2E(실인프라): policy 생성 → 시뮬레이터 threshold 위반 → RAISE+초기 webhook → 8초 후 escalation_rule
   발동+두 번째 webhook(다른 채널)+audit ESCALATE → ACK(감사)→재-ACK 409→RESOLVE. 지속 위반 동안 중복
   알람 미생성 확인

완료된 M10 작업 단위 (2026-07-10):
1. `apps/scheduler/src/schedule-math.ts` — ONE_TIME/DAILY/WEEKLY/MONTHLY/CRON due 판정 순수함수
   (UTC 기준, cron은 `cron-parser` 사용 — CJS 패키지라 named import는 tsc는 통과해도 Node ESM
   런타임에서 실패함을 실제 `node dist/index.js` 실행 중 발견해 default import로 수정), 16개 테스트
2. `packages/db/src/scheduler-repository.ts` — scheduler/schedule_run CRUD,
   `lockSchedulerById`(FOR UPDATE SKIP LOCKED, 다중 인스턴스 동시 처리 방지),
   `listGroupDeviceIds`(GROUP 타깃 fan-out용)
3. `apps/scheduler` 메인 루프 — 15초 폴링, 짧은 트랜잭션 안에서 row 잠금+due 판정+claim(schedule_run
   선기록) 후 커밋, 실제 MQTT 발행(`publishDeviceCommand` 재사용)은 트랜잭션 밖에서 수행
4. api: `SchedulersController`(ADMIN 전용 CRUD + runs 조회, 변경마다 audit)
5. E2E(실인프라) 중 실제 버그 발견 및 수정: `schedule_run.command_id`가 `command(command_id)` FK라
   클레임 시점(아직 command가 없음)에 미리 채우면 FK 위반 — commandId를 null로 클레임한 뒤 발행
   성공 후 backfill하도록 수정. ONE_TIME 정상 발화(1회만), GROUP 2개 기기 fan-out(각각 별도
   schedule_run), enable/disable/runs/delete 확인

완료된 Floor Map 편집 모드 작업 단위 (2026-07-10):
1. 실행/편집 모드 토글(ADMIN 전용), 기기 마커 드래그 이동, dirty 배지 + 저장/취소, 이탈 확인 다이얼로그
2. api: `PATCH /api/v1/spatial/floors/:id/layout`(ADMIN 전용, 위치 일괄 저장 + `DEVICE_RELOCATE` audit)
3. 실사용자 리포트로 실제 버그 2건 발견 및 수정: (a) Stage와 마커가 동시에 draggable이라 Stage가
   드래그를 가로채 도면 전체가 팬되는 버그, (b) Konva 이벤트 버블링으로 마커의 dragend가 Stage까지
   올라가 드롭 순간 도면이 기기 위치로 튀는 버그(`e.cancelBubble` + `e.target` 오리진 가드로 해결)
4. `dragBoundFunc`로 마커가 도면 경계 밖으로 나가지 않도록 클램프

완료된 WS 브로드캐스트 area 스코프 필터링 작업 단위 (2026-07-10):
1. `RealtimeWsServer`가 연결별 `AuthContext`를 보관하고 device→area 매핑을 30초 캐시로 조회해
   JWT `topics` claim과 대조(ADMIN 전체 수신, 캐시 미반영·area 미배정은 fail-closed로 숨김)
2. E2E: 실제 WS 클라이언트 2개(ADMIN, area 권한이 거실로 한정된 신규 테스트 유저)로 검증 —
   거실 기기 이벤트는 둘 다 수신, 침실 기기 이벤트는 area 권한 없는 유저에게만 미수신 확인

완료된 Device 연결 프로토콜 작업 단위 (2026-07-10, 사용자 요청으로 SRS/PROJECT_RULES 갱신 후 구현):
1. SRS 2.1.2·3.1.1, PROJECT_RULES 부록 A.1, `device-onboarding` 스킬 체크리스트에 요구사항 반영 —
   Device↔Gateway 구간 연결 방식이며 Gateway↔플랫폼(MQTT)은 대체하지 않는다는 경계를 명시
2. `packages/contracts`: `DeviceConnectionProtocol` enum(`TCP_IP`/`SERIAL`/`MODBUS_TCP`/
   `MODBUS_RTU`/`ZIGBEE`/`ZWAVE`) + `DeviceConnectionConfig` discriminated union(프로토콜별 연결
   파라미터 zod 스키마, 7개 테스트)
3. migration 0014 — `device.connection_protocol`(enum, nullable) + `connection_config`(jsonb, nullable)
4. `packages/db`: `updateDeviceConnection()`, device-repository/spatial-repository 양쪽 응답에 필드 반영
5. api: `PATCH /api/v1/devices/:id/connection`(ADMIN 전용, `DeviceConnectionConfig`로 요청 바디 검증,
   `DEVICE_CONNECTION_UPDATE` audit, `protocol:null`로 설정 해제 가능)
6. E2E(실인프라): 프로토콜-config 불일치(TCP_IP인데 comPort) 시 400, 올바른 MODBUS_TCP 설정 저장 후
   GET으로 재확인, 설정 해제, audit_log 2행(생성→해제) 확인
7. 알려진 한계: 관리 UI 없음 — Admin 전용 기기 관리 화면 자체가 아직 없어(M8 MVP 범위 밖) API로만 설정 가능

완료된 서버 상태 위젯 작업 단위 (2026-07-13, 상세는 [§M8](#m8-web-dashboard) 참고):
1. gateway/scheduler/device-simulator MQTT LWT(retained) 기반 프레즌스 → api `GET /health/system` 취합
2. 헤더 드래그 가능 위젯, api MQTT connect 리스너 순서 레이스·scheduler 재연결 후 ONLINE 누락 버그 수정
3. Redis 소켓 오류로 인한 프로세스 전체 죽음(uncaughtException) 방지 가드 추가

완료된 M12/M13 실기기·보안 작업 단위 (2026-07-13, 상세는 [§M12](#m12-device-onboarding--ota)·
[§M13](#m13-운영-보안) 참고):
1. `esp32/` PlatformIO 릴레이 보드(디지털아웃 10채널) 전등 제어 펌웨어 신설, `pio run` 컴파일 검증
2. `packages/db/src/seed-esp32-sample.ts` + `cascadeChildrenOffline()` — 보드 OFFLINE 시 하위 채널
   연쇄 처리, MQTT로 재현해 알람 10건 확인
3. Mosquitto `allow_anonymous` 폐지 + `packages/db/src/provision-mqtt-auth.ts`로 보드별 계정/ACL 발급,
   `packages/mqtt` `connect()` 단일 지점에서 인증 자동 적용
4. E2E: 보드 A 계정으로 보드 B 토픽 쓰기 시도가 조용히 버려짐(권한 격리) 확인, 인증 켠 상태 명령
   왕복 전체 경로 재검증

완료된 M13 TLS 설정 준비 작업 단위 (2026-07-14, 상세는 [§M13](#m13-운영-보안)·
[docs/tls-deployment.md](tls-deployment.md) 참고):
1. `infra/tls/generate-certs.sh` — 자체 서명 사설 CA + Mosquitto/API 서버 인증서 생성(실행해 CA
   체인 검증까지 확인), `infra/mosquitto/mosquitto.prod.conf` + `infra/docker-compose.prod.yml`
   (mqtts 8883/wss 9002만, 평문 없음, `docker compose config`로 문법 검증)
2. `packages/mqtt` `connect()`에 `MQTT_CA_FILE` 지원, `apps/api`에 `TLS_CERT_FILE`/`TLS_KEY_FILE`
   기반 https/wss 옵션 추가(둘 다 있을 때만 활성 — dev 영향 없음)
3. `esp32/`에 `MQTT_USE_TLS` 컴파일 스위치 추가(`WiFiClientSecure` + CA 인증서 + NTP 동기화 대기)
4. `pnpm typecheck && pnpm build` 전체 통과(21/21). `pnpm test`는 이 세션 환경의 시스템 메모리
   부족으로 재검증 못 함(코드와 무관한 환경 제약)

완료된 M14 Testcontainers 통합 테스트 작업 단위 (2026-07-14):

배경: `pnpm test`로 도는 기존 테스트(`packages/db` 포함)는 전부 가짜 in-memory `QueryExecutor`
mock을 쓰는 유닛 테스트라, 실제 Postgres 마이그레이션·Mosquitto 와이어 프로토콜(QoS/LWT/retained)·
Redis correlation을 검증하는 자동 테스트가 하나도 없었다. `docs/test-strategy.md` §2가 명시한
`api↔DB`, `gateway↔broker↔DB` integration 계층을 채운다.

1. `packages/test-support`(신규, private) — Postgres(`postgres:15`)/Redis(`redis:7-alpine`)/
   Mosquitto(`eclipse-mosquitto:2`, 테스트 전용 `allow_anonymous true`)를 Testcontainers로 병렬
   기동하는 `startTestInfra()`, `packages/db/migrations`를 대상 DB에 적용하는 `runMigrations()`,
   `packages/db/src/seed.ts`를 자식 프로세스로 실행하는 `runSeed()`(seed가 끝에서 `process.exit(0)`을
   호출해 import 불가 — 별도 프로세스 필수), 세 개를 묶은 `startTestEnvironment()`, 그리고
   비동기 MQTT 왕복을 폴링하는 `waitFor()` 헬퍼. `apps/api`/`apps/gateway` 통합 테스트가 공용으로 쓴다.
2. `apps/gateway/src/gateway.integration.test.ts` — `apps/gateway/src/index.ts`는 최상위에서 즉시
   실행되는 무한루프 프로세스라 import로 재사용할 수 없어, 빌드된 `dist/index.js`를 자식 프로세스로
   스폰해 블랙박스로 검증한다. 3케이스: telemetry 발행→DB 적재, OFFLINE state 수신→
   `device.current_status` 갱신+`alarm_log` 생성, `publishDeviceCommand()`로 명령 발행→테스트 클라이언트가
   device 역할로 SUCCEEDED ack 응답→`command`/`audit_log`(CREATED→PENDING→IN_PROGRESS→SUCCEEDED) 확인.
3. `apps/api/src/api.integration.test.ts` — `apps/api/src/modules/app.module.ts`는 부작용 없는 순수
   NestJS 모듈이라 `@nestjs/testing`(`Test.createTestingModule`)으로 in-process 부트스트랩(자동실행되는
   `index.ts`는 쓰지 않음), `supertest`로 HTTP 호출. 3케이스: 로그인 성공/실패(`audit_log` SUCCEEDED/
   FAILED 확인), `POST /commands`가 DB(command/audit_log)에 반영되고 실제 Mosquitto에 QoS1로 `cmd`를
   발행하는지 확인(device ack 왕복은 2번 gateway 테스트가 이미 커버해 중복 안 함).
4. **실제 버그 2건을 이 과정에서 발견해 수정**:
   - Nest+Vitest 호환성: Vitest 기본 변환기(esbuild)가 TypeScript의 `emitDecoratorMetadata`를 내지
     않아 `Reflector` 등 모든 생성자 주입이 `undefined`가 되고 모든 요청이 500이 됨 — 공식 Nest 레시피와
     동일한 문제. `vitest.integration.config.ts`에 `unplugin-swc`(decoratorMetadata: true) 플러그인을
     추가해 해결.
   - **refresh token 발급 충돌**: `packages/auth`의 `issueJwt()`가 `jti`(nonce) 없이 `sub+iat+exp` 등만
     서명해, 같은 사용자가 같은 초(second) 안에 두 번 로그인하면 byte-identical refresh JWT가 나와
     `refresh_token.token_hash` UNIQUE 제약 위반으로 로그인 자체가 500이 되는 실제 재현 가능한 버그였다
     (통합 테스트가 로그인을 연속 호출하며 우연히 재현). `JwtPayload`에 랜덤 `jti`를 추가해 해결 —
     탭 여러 개로 빠르게 재로그인하는 실사용 시나리오에서 발생할 수 있는 문제였다.
5. `turbo.json`에 `test:integration` 태스크(`dependsOn: ["^build"]`, `cache: false`) 추가, 루트
   `package.json`에 `test:integration` 스크립트 추가. `apps/api`/`apps/gateway`는 `vitest.config.ts`
   (기본 `test`가 `*.integration.test.ts` 제외)와 `vitest.integration.config.ts`(그 반대) 분리 —
   Docker 없이 도는 기존 `pnpm test`는 영향받지 않는다.
6. `.github/workflows/integration.yml` 신규 — `ci.yml`과 동일 트리거, `pnpm run build` →
   `pnpm run test:integration`. Testcontainers가 테스트 안에서 직접 컨테이너를 기동하므로
   `services:` 블록은 불필요(ubuntu-latest에 Docker 기본 설치). `ci.yml` 헤더 주석을 갱신해
   integration이 이 워크플로로 분리됐음을 명시.
7. 로컬 검증(Docker Desktop): 신규 통합 테스트 6케이스 전부 통과, 기존 `pnpm test`(유닛)는 Docker 없이도
   그대로 통과 확인(격리 검증).

알려진 단순화(후속 필요):
- Testcontainers Mosquitto는 테스트 전용 `allow_anonymous true`(격리된 1회성 컨테이너) — 프로덕션
  보드별 계정/ACL(M13) 경로 자체는 검증하지 않는다.
- gateway 통합 테스트는 spawn한 자식 프로세스의 표준출력 로그 문자열("공유구독 시작")로 준비 완료를
  판단한다 — 로그 문구가 바뀌면 같이 갱신해야 한다.
- api 통합 테스트는 명령의 device ack 왕복(SUCCEEDED 전이)까지는 검증하지 않는다(그 부분은 gateway
  테스트가 커버) — 순수하게 "api가 올바른 QoS/payload로 실제 발행했는가"만 본다.

다음 작업 단위 후보:
1. M11 AI/HITL — 추천 저장, confidence threshold, 고위험 기기 게이트, approve/reject, 학습데이터 저장
   (정책값은 구현 전 사용자 확인 필요) — **2026-07-14에 이미 완료**(§M11 참고), 이 목록 항목은 갱신 필요
2. M13 실배포 검증 — 배포 인프라(부록 A.2) 확정 후, 실제 호스트에서 mqtts/wss 핸드셰이크·
   `docker-compose.prod.yml` 기동 확인. ESP32 `MQTT_USE_TLS=true` 경로는 `pio run` 컴파일부터
   재검증 필요(이 세션 환경에 PlatformIO 없음)
3. M12 나머지 — credential 회수(기기 폐기 시 자동 revoke), OTA(job/명령/상태 추적), 실제 물리 ESP32
   하드웨어 현장 테스트
4. EVENT 스케줄 트리거 — 이벤트 소스 정의 필요(구현 전 사용자 결정)
5. Notification Channel/Escalation Rule 관리 API(현재는 SQL 직접 조작으로만 검증됨)
6. 권한 변경 API 구현 시 audit 강제, Group API 추가 시 group access guard 적용(별도 트랙)
7. M14 나머지 — Playwright E2E 도입(현재 `scripts/m16-device-e2e.cjs`가 `playwright`를 직접 require하는
   미커밋 ad-hoc 스크립트로만 존재 — `@playwright/test` 기반 정식 spec으로 전환) + CI 편입(풀스택
   프로세스 오케스트레이션 필요), 성능 테스트(k6/artillery) 착수
