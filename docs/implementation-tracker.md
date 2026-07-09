# 구현 추적 문서 — SmartHome IoT 관제 시스템

- 기준 문서: [iot_smarthome_srs.md](../iot_smarthome_srs.md), [PROJECT_RULES.md](../PROJECT_RULES.md)
- 작성일: 2026-07-09
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
| Device Simulator M1 | 완료 | `apps/device-simulator/src/*` |
| Gateway ingest M1 | 완료 | telemetry/state 수신, batch insert, status update, offline alarm |
| Command + Audit 핵심 경로 | 완료 | DB repository/transaction, gateway MQTT cmd/ack, Redis correlation, timeout sweeper |
| API 서버 | 진행 중 | NestJS bootstrap, health, command/device API, JWT auth guard, RBAC guard 완료. WS 미완료 |
| Auth/RBAC | 진행 중 | JWT 발급/검증, refresh token 저장/폐기, role/device access guard, MQTT topics claim 완료. 권한변경 audit 미완료 |
| Scheduler | 미완료 | `apps/scheduler`는 스캐폴딩 |
| Alarm service | 미완료 | 정책 평가/라우팅/에스컬레이션 미구현 |
| AI/HITL | 미완료 | 추천/승인/학습데이터 흐름 미구현 |
| Web dashboard | 미완료 | React/Konva 실앱 미구현 |
| 운영 보안 | 미완료 | TLS, Mosquitto auth/ACL plugin, service auth 미구현 |
| 통합/E2E/성능 테스트 | 미완료 | 현재는 contracts 중심 테스트 |

---

## 2. 검증 기준선

마지막 확인 결과:

| 명령 | 결과 | 비고 |
|---|---:|---|
| `pnpm build` | 통과 | 11개 패키지 build 성공 |
| `pnpm typecheck` | 통과 | 15개 task 성공 |
| `pnpm test` | 통과 | 55개 (contracts 34, db 14, auth 4, command-flow 3) |
| E2E 인제스트 | 통과 | simulator→gateway→telemetry 적재, state 반영, offline alarm (2026-07-09) |
| **E2E 명령 전체 경로** | **통과** | login→`POST /commands`→MQTT→simulator ack→**SUCCEEDED**, 멱등성(published:false), **NO_ACK 결함→TIMED_OUT**. 두 경로 모두 audit 4행 체인(CREATED→PENDING→IN_PROGRESS→종결) DB 검증 (2026-07-09) |

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
- 로그인/권한변경 audit

완료 조건:
- 권한 없는 Device 조회/제어가 거부된다. 완료
- JWT claim으로 MQTT ACL 정책을 만들 수 있다. 완료
- 로그인/권한변경 audit이 남아 있다.

### M7. Realtime Dashboard Bridge

상태: 미완료

작업:
- API WebSocket `/ws/realtime`
- gateway event -> Redis pub/sub 또는 DB event bridge
- state/alarm/command status push
- dashboard overview API

완료 조건:
- state 변경과 command 상태 변경이 WebSocket으로 전달된다.

### M8. Web Dashboard

상태: 미완료

작업:
- Vite + React bootstrap
- Konva floor map
- device marker/status color
- device drawer
- command button
- timeline/alarm panel
- WebSocket 연결

완료 조건:
- Floor Map에서 device 상태가 표시된다.
- 사용자가 허가된 device command를 보낼 수 있다.
- 알람/타임라인이 실시간으로 갱신된다.

### M9. Alarm Service

상태: 미완료

작업:
- alarm_policy CRUD
- telemetry threshold evaluation
- reactive/proactive/optimization 분류
- alarm action: ack/snooze/resolve/note
- escalation rule
- notification channel provider 연동

완료 조건:
- 정책에 따라 alarm_log가 생성된다.
- ack/snooze/resolve가 상태와 이력에 반영된다.
- notification provider는 구현 전 사용자 결정 필요.

### M10. Scheduler

상태: 미완료

작업:
- one-time/daily/weekly/monthly/cron/event 실행
- distributed lock
- missed schedule 처리
- schedule_run 기록
- command path 재사용
- scheduler 변경 audit

완료 조건:
- scheduler가 command를 발행하고 command/audit lifecycle을 재사용한다.

### M11. AI/HITL

상태: 미완료

작업:
- recommendation 저장
- confidence threshold
- high-risk device 목록
- approve/reject endpoint
- 승인 후 command path 재사용
- `hitl_decision`, `ai_training_sample` 저장

완료 조건:
- 저신뢰/고위험 추천은 승인 없이 실행되지 않는다.
- approve/reject가 모두 학습 데이터로 저장된다.

### M12. Device Onboarding / OTA

상태: 미완료

작업:
- device credential 발급/회수
- simulator credential 적용
- OTA job 생성
- `ota_update` command 발행
- `ota_target` 상태 추적

완료 조건:
- 신규 device가 credential 기반으로 등록/연결된다.
- OTA 명령과 결과가 audit/ota_target에 남는다.

### M13. 운영 보안

상태: 미완료

작업:
- Mosquitto TLS 설정
- WSS/mqtts only
- auth/ACL plugin 결정 및 연동
- service API key 또는 mTLS
- `.env.example` 정리

완료 조건:
- dev-only 평문 포트와 production TLS 구성이 명확히 분리된다.
- 사용자/기기별 MQTT ACL이 적용된다.

### M14. 테스트/검증 체계

상태: 미완료

작업:
- repository unit test
- gateway integration test
- Mosquitto + Postgres testcontainers
- simulator E2E
- Playwright dashboard test
- command/audit 불변식 테스트
- QoS/retained/LWT 테스트

완료 조건:
- PROJECT_RULES 위반이 테스트에서 잡힌다.
- command/audit 경로는 정상/실패/타임아웃/중복 케이스를 모두 검증한다.

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

## 5. 열린 결정 항목

`PROJECT_RULES.md` 부록 A.2 기준:

| 항목 | 현재 상태 | 구현 전 필요 결정 |
|---|---|---|
| Notification Channel provider | 미정 | push/email/SMS/webhook 중 우선 구현체 |
| AI 추천 엔진 배치/서빙 방식 | 미정 | batch, online serving, 외부 모델 여부 |
| 배포/인프라 | 미정 | K8s 여부, Mosquitto HA/브리징 여부 |

---

## 6. 다음 추천 작업

다음 구현은 **M6 Auth/RBAC의 audit 보강** 또는 **M7 Realtime Dashboard Bridge**부터 진행한다.

이유:
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

다음 작업 단위:
1. 로그인/refresh/logout audit 기록 추가
2. 권한 변경 API 구현 시 audit 강제
3. Group API 추가 시 group access guard 적용
4. M7 WebSocket realtime bridge 시작
5. `pnpm build && pnpm typecheck && pnpm test` 통과
