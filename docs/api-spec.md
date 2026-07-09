# REST API 명세서 — SmartHome IoT 관제 시스템

- 스타일: **OpenAPI 3.1 / Swagger** 기준 (본 문서는 요약 명세, 기계 판독본은 §11 스켈레톤)
- 근거: [iot_smarthome_srs.md](../iot_smarthome_srs.md), [PROJECT_RULES.md](../PROJECT_RULES.md), [erd.md](erd.md), [mqtt-topic-design.md](mqtt-topic-design.md)
- 상태: 초안 v0.1 (2026-07-09)

---

## 1. 공통 규약

| 항목 | 규칙 |
|---|---|
| Base URL | `/api/v1` |
| 인증 | `Authorization: Bearer <JWT>` (§PROJECT_RULES 5, 로그인 제외 전 엔드포인트 필수) |
| 콘텐츠 | `application/json; charset=utf-8` |
| 시각 | ISO 8601 `timestamptz` (예 `2026-07-09T10:21:00Z`) |
| RBAC | 각 엔드포인트 표의 **Role** 열 기준. Area/Device/Group 권한은 리소스 단위 검사(SRS 2.1.6) |
| 감사 | 로그인·권한변경·제어·스케줄러변경·알람승인은 `audit_log` 기록(SRS 4.2.4) |

### 1.1 에러 포맷 (RFC 7807 problem+json)
```json
{ "type": "about:blank", "title": "Forbidden", "status": 403,
  "code": "AREA_ACCESS_DENIED", "detail": "user has no CONTROL on area 'living-room'",
  "instance": "/api/v1/commands" }
```
공통 코드: `401 UNAUTHENTICATED`, `403 *_ACCESS_DENIED`, `404 NOT_FOUND`,
`409 CONFLICT`(멱등성 위반 포함), `422 VALIDATION_ERROR`, `429 RATE_LIMITED`.

### 1.2 페이지네이션 / 목록 응답
- 쿼리: `?page=1&size=50&sort=createdAt:desc` (또는 시계열은 `?from&to`)
- 응답 봉투:
```json
{ "data": [ ], "page": 1, "size": 50, "total": 1234 }
```

### 1.3 멱등성
- 제어 명령 생성은 **`commandId`가 멱등성 키**(§PROJECT_RULES 4.1). 헤더 `Idempotency-Key`
  또는 body `commandId`로 전달. 동일 키 재요청은 최초 결과를 반환(재실행 없음).

---

## 2. 인증 (Auth)

| Method | Path | Role | 설명 |
|---|---|---|---|
| POST | `/auth/login` | 공개 | 로그인 → JWT 발급 |
| POST | `/auth/refresh` | 공개(refresh) | access 토큰 재발급 |
| POST | `/auth/logout` | 인증 | refresh 토큰 무효화 |
| GET | `/auth/me` | 인증 | 내 프로필·역할·권한 |

**POST /auth/login**
```json
// req
{ "username": "admin", "password": "***" }
// res 200
{ "accessToken": "ey...", "refreshToken": "ey...", "expiresIn": 900,
  "user": { "id": "u-1", "roles": ["ADMIN"] } }
```
- 발급 JWT claim에 `roles`, ACL용 `topics`(§mqtt-topic-design 6.3) 포함.

---

## 3. 공간 (Spatial, SRS 2.1.1)

| Method | Path | Role | 설명 |
|---|---|---|---|
| GET/POST | `/sites` · `/buildings` · `/floors` | ADMIN(쓰기)/전체(읽기) | 공간 계층 CRUD |
| GET/PATCH/DELETE | `/sites/{id}` 등 | ADMIN | 개별 관리 |
| POST | `/floors/{id}/map` | ADMIN | 평면도 업로드(multipart) |
| PATCH | `/floors/{id}/map` | ADMIN | 스케일(`scaleMPerPx`) 지정 |
| GET/POST | `/areas` | ADMIN(쓰기) | Polygon 공간 생성 |
| GET/PATCH/DELETE | `/areas/{id}` | ADMIN | 수정/삭제 |
| PATCH | `/floors/{id}/layout` | ADMIN | **편집 모드 배치 저장**: 여러 기기 좌표/Area를 일괄 커밋 |

**PATCH /floors/{id}/layout** (도면 편집 모드 저장, §ui-ux 4.1-mode)
```json
{ "devices": [
  { "id": "d-1", "areaId": "a-1", "posX": 260, "posY": 190 },
  { "id": "d-2", "areaId": "a-1", "posX": 320, "posY": 210 }
] }
// 원자적 처리(전체 성공/실패), 각 이동은 audit_log(DEVICE_RELOCATE) 기록
```
> 단건 이동은 `PATCH /devices/{id}/location`(§4)도 가능. 편집 모드 일괄 저장은 이 엔드포인트 사용.

**POST /areas**
```json
{ "floorId": "f-2", "slug": "living-room", "name": "거실",
  "polygon": [[120,80],[400,80],[400,300],[120,300]] }
```

---

## 4. 기기 · 그룹 (Device, SRS 3.1)

| Method | Path | Role | 설명 |
|---|---|---|---|
| GET | `/devices` | 인증(권한 Area 한정) | 목록. `?areaId&status&groupId&type` 필터 |
| POST | `/devices` | ADMIN | 기기/센서/게이트웨이 등록 |
| GET/PATCH/DELETE | `/devices/{id}` | ADMIN(쓰기) | 개별 관리 |
| PATCH | `/devices/{id}/location` | ADMIN | `(areaId, posX, posY)` 지정 |
| GET | `/devices/{id}/state` | VIEW | 현재 상태(retained 미러) |
| GET | `/devices/{id}/history` | VIEW | Device History Drawer(SRS 5.4): 24h 이벤트·제어·알람·조치 |
| GET | `/devices/{id}/telemetry` | VIEW | `?metric&from&to&agg=raw\|1m\|1h` (TimescaleDB) |
| GET | `/devices/{id}/alarms` | VIEW | 기기 알람 이력 |
| GET | `/devices/{id}/commands` | VIEW | 기기 제어 이력 |
| GET/POST | `/device-groups` | ADMIN(쓰기) | 그룹/Dynamic Group |
| GET/PATCH/DELETE | `/device-groups/{id}` | ADMIN | 개별 관리 |
| PUT/DELETE | `/device-groups/{id}/devices/{deviceId}` | ADMIN | N:M 매핑 추가/제거 |

**POST /devices** (요청 필드 = ERD device)
```json
{ "code": "light-01", "name": "거실 조명", "category": "DEVICE",
  "deviceType": "light", "manufacturer": "Acme", "model": "L-100",
  "firmwareVersion": "1.2.0", "areaId": "a-1", "posX": 260, "posY": 190,
  "gatewayId": "gw-1" }
// res: mqttTopic 은 서버가 buildTopic()으로 생성해 반환
```

---

## 4-cam. PTZ 카메라 (옵션 기능)

카메라는 `category=CAMERA` device이므로 §4 기기 엔드포인트를 그대로 쓰고, 아래 전용 엔드포인트를 추가한다.

| Method | Path | Role | 설명 |
|---|---|---|---|
| GET | `/cameras` | VIEW | 카메라 목록(`?areaId&isPtz`). = `/devices?category=CAMERA` |
| GET/PATCH | `/cameras/{id}` | ADMIN(쓰기)/VIEW | 스트림·PTZ·커버리지 설정 |
| GET | `/cameras/{id}/stream` | VIEW | **서명된 단기 스트림 URL/WebRTC offer** 발급(미디어 서비스) |
| POST | `/cameras/{id}/ptz` | CONTROL | PTZ 이동 `{pan,tilt,zoom}` 또는 `{stop:true}` |
| GET/POST | `/cameras/{id}/presets` | VIEW/ADMIN | 프리셋 조회/생성 |
| POST | `/cameras/{id}/presets/{presetId}/goto` | CONTROL | 프리셋 이동 |
| PUT/DELETE | `/cameras/{id}/coverage/areas/{areaId}` | ADMIN | 커버 Area 매핑 |
| GET | `/alarms/{id}/cameras` | VIEW/MONITOR | 알람 발생원(Area/기기)을 **커버하는 카메라 목록**(현장 확인용) |

**POST /cameras/{id}/ptz** — 내부적으로 §5 명령 흐름(`command=ptz_move`, target=카메라)로 매핑. 감사 기록됨.
```json
{ "pan": 10, "tilt": -5, "zoom": 0 }   // 또는 { "stop": true }
```

> 스트림 URL은 단기 서명(만료) + 권한 검사 후 발급. 영상은 MQTT가 아닌 미디어 서비스 경로(§architecture).

## 4-life. 프로비저닝 · 수명주기 · 펌웨어 OTA (§device-lifecycle-ota)

| Method | Path | Role | 설명 |
|---|---|---|---|
| POST | `/devices/bulk` | ADMIN | 대량 기기 등록 |
| POST | `/devices/{id}/provision` | ADMIN | 자격증명 발급(1회성 반환) |
| POST | `/provision/bulk` | ADMIN | 대량 자격 발급 |
| DELETE | `/devices/{id}/credentials` | ADMIN | 자격 회수(ACL 즉시 무효화) |
| PATCH | `/devices/{id}/lifecycle` | ADMIN | 수명주기 상태 전이 |
| GET/POST | `/firmware` | ADMIN | 펌웨어 레지스트리(버전·체크섬·서명·대상 타입) |
| POST | `/ota/jobs` | ADMIN | OTA 롤아웃 잡 생성(대상·전략) |
| GET | `/ota/jobs/{id}` | ADMIN | 잡 진행/타겟별 상태 |
| POST | `/ota/jobs/{id}/pause` · `/resume` · `/abort` | ADMIN | 롤아웃 제어 |

**POST /ota/jobs**
```json
{ "firmwareId": "fw-130", "targetType": "GROUP", "targetId": "g-lights",
  "strategy": "CANARY" }
// 내부적으로 각 기기에 ota_update 명령(§5 흐름) 발행, ota_target 추적, 실패율 임계 초과 시 자동 중단
```
> 자격/펌웨어 서명키는 시크릿 저장소(보안 심화 후속). 모든 프로비저닝·OTA·회수는 ADMIN 전용 + 감사.

## 5. 제어 명령 (Command, SRS 3.1.3 + 4.3)

| Method | Path | Role | 설명 |
|---|---|---|---|
| POST | `/commands` | CONTROL(대상 Area) | 단일 기기 제어 명령 발행 |
| POST | `/device-groups/{id}/commands` | CONTROL | 그룹/배치 제어(서버가 멤버로 팬아웃) |
| GET | `/commands/{commandId}` | VIEW | 명령 상태/수명주기 조회 |
| GET | `/commands` | VIEW | `?deviceId&status&from&to` 필터 |

**POST /commands**
```json
// req  (commandId 생략 시 서버 생성)
{ "commandId": "CMD-20260709-001", "command": "turn_on",
  "target": { "type": "DEVICE", "id": "light-01" }, "args": {} }
// res 202 Accepted
{ "commandId": "CMD-20260709-001", "status": "PENDING",
  "sessionId": "A1001", "acceptedAt": "2026-07-09T10:22:00Z" }
```
- 서버 처리: `command` 생성(CREATED→PENDING) → MQTT `/cmd` 발행(User Properties 포함) →
  ack에 따라 IN_PROGRESS→SUCCEEDED/FAILED, SLA 초과 시 TIMED_OUT. **모든 전이 `audit_log` 기록**.
- 상태 폴링은 `GET /commands/{commandId}`, 실시간은 WebSocket(§9)로 push.

---

## 6. 사용자 · 권한 (RBAC, SRS 2.1.6)

| Method | Path | Role | 설명 |
|---|---|---|---|
| GET/POST | `/users` | ADMIN | 사용자 목록/생성 |
| GET/PATCH/DELETE | `/users/{id}` | ADMIN | 개별 관리 |
| PUT | `/users/{id}/roles` | ADMIN | 역할 지정(`["USER","MONITOR"]`) |
| PUT/DELETE | `/users/{id}/permissions/areas/{areaId}` | ADMIN | Area 권한(`accessLevel`) |
| PUT/DELETE | `/users/{id}/permissions/devices/{deviceId}` | ADMIN | Device 권한 |
| PUT/DELETE | `/users/{id}/permissions/groups/{groupId}` | ADMIN | Group 권한 |

---

## 7. 알람 (Alarm, SRS 3.3 + 2.2/2.3)

| Method | Path | Role | 설명 |
|---|---|---|---|
| GET/POST | `/alarm-policies` | ADMIN(쓰기) | 정책(tier/임계치/severity/escalation) |
| GET/PATCH/DELETE | `/alarm-policies/{id}` | ADMIN | 개별 관리 |
| GET/POST | `/notification-channels` | ADMIN | 알림 채널 |
| GET | `/alarms` | VIEW/MONITOR | 알람 이력. `?state&severity&tier&deviceId` |
| POST | `/alarms/{id}/ack` | USER/MONITOR | 확인(Acknowledge) |
| POST | `/alarms/{id}/snooze` | USER | Snooze(`until`) |
| POST | `/alarms/{id}/resolve` | MONITOR | 해제 |
| POST | `/alarms/{id}/actions` | MONITOR | 조치 이력 등록(note) |

- **카메라 연동(옵션)**: `alarm-policies` 생성/수정 시 `linkedCameraId`·`autoGotoPresetId`를 지정하면
  알람 발생 시 해당 카메라를 프리셋으로 자동 이동하고, 알람 화면에서 즉시 현장 확인(§4-cam, §ui-ux).

---

## 8. 스케줄러 (Scheduler, SRS 3.4)

| Method | Path | Role | 설명 |
|---|---|---|---|
| GET/POST | `/schedulers` | ADMIN | 일정 생성(OneTime/Daily/Weekly/Monthly/Cron/Event) |
| GET/PATCH/DELETE | `/schedulers/{id}` | ADMIN | 개별 관리 |
| POST | `/schedulers/{id}/enable` · `/disable` | ADMIN | 활성/비활성 |
| GET | `/schedulers/{id}/runs` | VIEW | 실행 이력(command 연결) |

**POST /schedulers**
```json
{ "name": "야간 소등", "targetType": "GROUP", "targetId": "g-lights",
  "scheduleType": "CRON", "cronExpr": "0 23 * * *",
  "payload": { "command": "turn_off" }, "enabled": true }
```

---

## 9. AI 추천 · HITL (SRS 3.5)

| Method | Path | Role | 설명 |
|---|---|---|---|
| GET | `/recommendations` | HITL_APPROVER/MONITOR | 추천 목록. `?status=PENDING_APPROVAL` |
| GET | `/recommendations/{id}` | HITL_APPROVER | 상세(confidence, 대상, 제안 명령) |
| POST | `/recommendations/{id}/approve` | HITL_APPROVER | 승인 → 제어 실행(§5 흐름) |
| POST | `/recommendations/{id}/reject` | HITL_APPROVER | 거절 |

- Approve/Reject는 **모두 학습 데이터로 저장**(ERD `hitl_decision`/`ai_training_sample`).
- 고위험 장치(메인 차단기·도어락·가스 차단·전체 조명) 또는 confidence < 임계치면 승인 필수.

**POST /recommendations/{id}/approve**
```json
// req
{ "reason": "외출 확인" }
// res 202 → 내부적으로 POST /commands 흐름 (actorType=AI, 승인자 기록)
{ "commandId": "CMD-20260709-014", "status": "PENDING" }
```

---

## 10. 감사 로그 · 대시보드

| Method | Path | Role | 설명 |
|---|---|---|---|
| GET | `/audit-logs` | ADMIN/MONITOR | `?actorType&targetId&executionStatus&from&to` (보존 5년, SRS 6) |
| GET | `/dashboard/overview` | 인증 | 공간·기기·알람·offline·network 요약(SRS 5.1) |
| GET | `/dashboard/timeline` | 인증 | System Timeline 이벤트(SRS 5.2) |
| WS | `/ws/realtime` | 인증 | 상태/알람/명령 상태 실시간 push(§mqtt-topic-design 8) |

---

## 11. OpenAPI 스켈레톤 (발췌)

> 전체 기계 판독본은 후속으로 `docs/openapi.yaml` 생성 예정. 아래는 앵커용 발췌.

```yaml
openapi: 3.1.0
info: { title: SmartHome Control API, version: 0.1.0 }
servers: [{ url: /api/v1 }]
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer, bearerFormat: JWT }
  schemas:
    CommandRequest:
      type: object
      required: [command, target]
      properties:
        commandId: { type: string, description: 전역 유일·멱등성 키 }
        command:   { type: string, example: turn_on }
        target:
          type: object
          required: [type, id]
          properties:
            type: { type: string, enum: [DEVICE, GROUP] }
            id:   { type: string }
        args: { type: object }
security: [{ bearerAuth: [] }]
paths:
  /commands:
    post:
      summary: 제어 명령 발행
      requestBody:
        content: { application/json: { schema: { $ref: '#/components/schemas/CommandRequest' } } }
      responses:
        '202': { description: Accepted }
        '403': { description: Area access denied }
        '409': { description: Idempotency conflict }
```

---

## 12. 미해결/후속 (부록 A.2 연계)

- `docs/openapi.yaml` 전체 기계 판독본 생성(코드젠 연동)
- WebSocket 이벤트 스키마 상세(`/ws/realtime` 메시지 계약)
- 알림 채널 provider별 config 스키마
- Rate limiting·API Key 발급 정책(서비스 간 연동)
