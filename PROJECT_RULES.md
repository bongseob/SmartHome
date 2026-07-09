# PROJECT_RULES — SmartHome IoT 관제 시스템 구현 규칙

이 문서는 [iot_smarthome_srs.md](iot_smarthome_srs.md)를 실제 구현으로 옮길 때
**반드시 지켜야 하는 합의된 기술/운영 규칙**을 정의한다.
SRS는 "무엇을", 이 문서는 "어떻게"를 정한다. 충돌 시 SRS의 기능 정의가 우선하고,
구현 방식은 이 문서를 따른다.

> 에이전트 작업 지시와 고정 결정 요약은 [AGENTS.md](AGENTS.md)에 있다.
> 규칙 본문 수정은 이 파일에서만 한다.

**섹션 구성**: 기반(§1) → 메시징(§2~§3) → 명령·감사(§4) → 보안·접근제어(§5~§6)
→ 로깅(§7) → 도메인 기능(§8~§9) → 성능(§10) → 프로세스(§11) → 부록(결정 근거·열린 항목).

---

## 1. 기술 스택 & 공유 원칙 (확정)

| 계층 | 스택 |
|---|---|
| Backend | **Node.js + TypeScript**, NestJS (모듈 = 마이크로서비스 경계) |
| MQTT | **Mosquitto** broker + `mqtt.js` 클라이언트, **MQTT 5** |
| Frontend | **React + TypeScript**, Floor Map은 Konva, MQTT는 WebSocket(wss) 구독 |
| 관계형 DB | **PostgreSQL** (RBAC, Device, Group, Audit_Log, Alarm_Log) |
| DB 접근 | **`pg` + repository 패턴** (ORM 미사용), 마이그레이션은 **node-pg-migrate** |
| 시계열 DB | **TimescaleDB** (Telemetry hypertable, 집계는 continuous aggregate) |
| 상태 공유 | Redis (Retained 상태 캐시, 세션, HITL 대기열) |
| 모노레포 | **pnpm workspaces + Turborepo** (태스크 캐시/병렬 빌드) |
| 인증 | **JWT 자체 발급 우선** (자세히 §5) |

- 언어는 **TypeScript strict 모드**. `any` 금지, 도메인 타입은 `packages/contracts`에 공유.
- 백엔드/프론트가 공유하는 payload·enum·토픽 규칙은 **단일 소스(`packages/contracts`)**에서만 정의하고 양쪽이 import 한다. 문자열 리터럴 중복 금지.

> 각 스택을 왜 선택했는지는 [부록 A](#부록-a-결정-근거--열린-항목) 참조.

---

## 2. UNS 토픽 규칙 (절대 규칙)

모든 토픽은 다음 계층을 **순서대로** 따른다:

```
enterprise/{site}/{building}/{floor}/{area}/{device}
```

- 토픽 문자열을 코드에 하드코딩하지 말 것. `buildTopic({...})` 헬퍼(contracts)로만 생성한다.
- 세그먼트는 소문자 kebab-case, 공백·슬래시·`+`·`#` 금지.
- 목적별 하위 suffix 고정:
  - 상태(현재값): `.../{device}/state` — **Retained + QoS 1**
  - 텔레메트리: `.../{device}/telemetry` — **QoS 0, Retained 아님**
  - 제어 명령: `.../{device}/cmd` — **QoS 1**
  - 명령 결과: `.../{device}/cmd/ack` — **QoS 1**
  - 크리티컬 알람: `.../{device}/alarm` — **QoS 2**
  - LWT: `.../{device}/state` 에 offline payload (규칙은 §3.2)

---

## 3. MQTT 통신 규칙

### 3.1 QoS (SRS 4.1.1 — 위반 금지)

| 데이터 | QoS |
|---|---|
| Telemetry | 0 |
| Control(cmd/ack) | 1 |
| Critical Alarm | 2 |

### 3.2 LWT (SRS 4.1.2)

모든 device 연결은 `connect` 시 LWT를 **필수** 등록한다.
LWT topic = `.../{device}/state`, payload = `{ "status": "OFFLINE", "ts": <epoch_ms> }`, retained=true.

### 3.3 Retained

`state` 토픽만 retained. telemetry·cmd·alarm은 retained 금지(오래된 명령 재실행 위험).

---

## 4. 표준 제어 명령 & 수명주기 (SRS 3.1.3 + 4.3 — 핵심 규칙)

### 4.1 Payload (JSON body)

```json
{ "sessionId": "...", "commandId": "...", "command": "turn_on", "target": "device01" }
```

필수 필드: `sessionId`, `commandId`, `command`, `target`, 그리고 `timestamp`(epoch ms).
- `commandId`는 전역 유일(예: `CMD-YYYYMMDD-<seq>`), **멱등성 키**로 사용한다. 동일 commandId 재수신 시 재실행 금지.

### 4.2 명령 메타데이터는 Payload가 아닌 **MQTT 5 User Properties**로 (SRS 4.3.3)

`Actor_ID`, `Session_ID`, `Command_ID`, `Role`, `Request_Time` 는 User Properties에 싣는다.
payload에 actor/role 등 감사 메타데이터를 중복해서 넣지 말 것.

### 4.3 명령 수명주기 = 상태 머신 (SRS 4.3.4 — 위반 금지)

```
CREATED → PENDING → IN_PROGRESS → SUCCEEDED
                              └→ FAILED
                              └→ TIMED_OUT
```

- **모든 상태 전이는 반드시 `Audit_Log`에 1행씩 기록**한다. 상태를 건너뛰거나 로그 없이 전이 금지.
- 정의된 타임아웃(기본 명령 SLA 내) 안에 `ack`이 없으면 `TIMED_OUT`으로 전이하고 기록.
- 실패 시 `MQTT Reason Code`를 반드시 채운다.

### 4.4 Audit_Log 스키마 (SRS 4.3.2 — 컬럼 고정)

`Log ID(PK)`, `Timestamp`, `Actor Type(ADMIN/USER/AI/SYSTEM)`, `Actor ID`,
`Target Type(Device/Group)`, `Target ID`, `Command`, `Reason`,
`Execution Status(CREATED/PENDING/IN_PROGRESS/SUCCEEDED/FAILED/TIMED_OUT)`,
`MQTT Reason Code`, `Session ID`, `Command ID`.

> 제어를 유발하는 코드는 절대 Audit_Log 기록을 생략할 수 없다. 기록 없는 제어 = 버그.

---

## 5. 보안 & 인증 (SRS 4.2)

### 5.1 전송 보안
- 모든 MQTT/HTTP 통신은 **TLS(wss/mqtts)**. 평문 포트 비활성화.

### 5.2 MQTT ACL
- 사용자는 자신의 Area 서브트리(`enterprise/site1/areaA/#`)만 구독/발행. Admin은 `enterprise/#`.
- ACL은 broker 정책 파일이 아니라 인증 시 발급하는 **JWT claim(`topics`)** 기준으로 동적 적용.

### 5.3 인증 방식 (JWT 자체 발급 우선)
- **사용자**: 로그인 → 서버가 JWT(access + refresh) 발급. ACL은 이 JWT의 claim 기준(§5.2).
- **기기**: MQTT username/password (기기별 자격 증명).
- **서비스 간**: mTLS 또는 API Key.
- OAuth2 / OIDC(Keycloak 등)는 Multi-tenant 확장 시점에 추가(SRS 7). 그 전까지 우선순위는 JWT.

---

## 6. RBAC & 권한 (SRS 2)

| Role | 핵심 권한 |
|---|---|
| ADMIN | 공간/기기/그룹/자동화/알람정책/사용자 전체 관리, `enterprise/#` |
| USER | 허가된 Area만: 조회, ON/OFF, 센서/이력 조회, 알람 Ack/Snooze |
| MONITOR | 실시간 감시, 긴급 알람 대응, 이벤트/장애 확인, 조치 이력 등록 |
| HITL 승인자 | AI 제안 제어의 최종 Approve/Reject |

- 권한 검사는 **Area·Device·Group 단위**. 라우트 가드에서 리소스 소유 Area를 확인한다.
- 권한 변경·로그인·제어·스케줄러 변경·알람 승인은 모두 감사 로그 대상(SRS 4.2.4).

---

## 7. 로깅·감사 3계층 (SRS 4.3.1)

- **Telemetry Log** → TimescaleDB (원본 1년, 집계 5년+).
- **Alarm Log** → `Alarm_Log` 테이블.
- **Audit Log** → `Audit_Log` 테이블(스키마 §4.4), **보존 5년 이상**.

세 로그를 섞지 말 것. 센서값을 Audit_Log에, 제어이력을 Telemetry에 넣는 것은 규칙 위반.

---

## 8. 알람 3계층 (SRS 3.3)

| 계층 | 의미 | 처리 |
|---|---|---|
| Reactive | 화재·침입·누수·고장 (즉시) | QoS 2, 즉시 라우팅+에스컬레이션 |
| Proactive | 배터리·필터·펌웨어 (예방) | 배치/스케줄 알림 |
| Optimization | 불필요 조명·에너지·온도 (안내) | 대시보드 안내, 저심각도 |

알람 정책은 `임계치 / Severity / Routing Rule / Notification Channel / Escalation Rule`을 갖는다.
알람은 `Alarm_Log`에 별도 저장(Audit_Log와 분리).

---

## 9. AI 추천 & HITL (SRS 3.5 — 안전 규칙)

- AI는 이상행동/에너지/외출/취침/위험예측을 추천한다. 추천은 **직접 실행하지 않는다**.
- **Confidence Score < 임계치**이거나 대상이 **고위험 장치(메인 차단기·도어락·가스 차단·전체 조명)**이면
  반드시 HITL 승인(Approve/Reject)을 거친다. 승인 없이 실행 금지.
- 사용자의 Approve/Reject는 **모두 학습 데이터로 저장**한다(누락 금지).
- AI가 유발한 제어의 Audit_Log `Actor Type`은 `AI`, 승인자는 `Reason`/별도 승인 이력에 남긴다.

---

## 10. 성능 목표 (SRS 6 — 설계 제약)

- MQTT 명령 처리 지연 평균 ≤ **300ms**
- 센서 반영 지연 ≤ **1s**, 알람 전파 ≤ **3s**
- 동시 사용자 ≥ **500**, 동시 기기 ≥ **100,000**
- 가용성 ≥ **99.9%**

→ 브로커/게이트웨이는 수평 확장 가능해야 하고, device 단위 동기 블로킹 호출을 피한다.

---

## 11. 코드 작성 & 프로세스 규칙

- 새 제어 명령·기기 타입·알람 규칙·AI 추천을 추가할 때는 `.claude/skills/`의 스킬 체크리스트를 절차로 따른다:
  `mqtt-command`, `device-onboarding`, `alarm-rule`, `hitl-recommendation`.
- DB 스키마 변경은 **node-pg-migrate 마이그레이션 파일로만**. 수동 DDL 금지.
- 도메인 enum(상태, ActorType, ExecutionStatus 등)은 `packages/contracts`에서만 정의.
- 감사·보안·QoS·수명주기 규칙을 우회하는 "임시" 코드 금지. 지름길이 곧 규정 위반이다.
- **프로젝트 산출물 문서(설계·명세·다이어그램 등)는 `docs/` 폴더에서 관리**하고,
  생성 시 [docs/README.md](docs/README.md) 목록에 등록한다. 규칙/지시 파일과 SRS 원본은 루트 유지.

---

## 부록 A. 결정 근거 & 열린 항목

### A.1 결정 근거 (2026-07-09 합의)
- **MQTT Broker = Mosquitto (전용 프로세스, 앱 내장 금지)**: 브로커를 앱에 내장하면
  백엔드 재배포마다 기기 연결이 끊긴다. 분리하면 세션이 유지된다. 단일 노드 한계가
  문제되면 그때 브리징/교체를 별도 논의(→ A.2).
- **DB = ORM 미사용**: `pg` + repository로 SQL을 직접 통제. 스키마는 node-pg-migrate로만 변경(§11).
- **인증 = JWT 자체 발급 우선**: 외부 IdP 의존 없이 시작. OAuth2/OIDC는 Multi-tenant 확장(SRS 7) 시점.
- **모노레포 = pnpm + Turborepo**: `packages/contracts` 공유 + Turborepo 태스크 캐시/병렬 빌드.

### A.2 남은 열린 항목 (구현 진행하며 결정)
- Notification Channel 구현체(push/email/SMS provider)
- AI 추천 엔진 배치/서빙 방식(MLOps, SRS 7)
- 배포/인프라(K8s, Mosquitto HA 구성)
