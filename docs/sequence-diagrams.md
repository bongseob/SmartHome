# 시퀀스 다이어그램 — SmartHome IoT 관제 시스템

- 근거: [PROJECT_RULES.md](../PROJECT_RULES.md), [erd.md](erd.md), [mqtt-topic-design.md](mqtt-topic-design.md), [api-spec.md](api-spec.md), [architecture.md](architecture.md)
- 상태: 초안 v0.1 (2026-07-09)

공통 참여자: `Web`(대시보드), `api`, `Redis`, `Mosquitto`, `gateway`, `Device`, `DB`(PostgreSQL/TimescaleDB), `ai-engine`.
모든 제어/승인/권한변경은 **`audit_log`에 기록**된다(SRS 4.2.4). 명령 상태 전이는 audit와 **동일 트랜잭션**.

---

## 1. 로그인 / 인증 (JWT)

```mermaid
sequenceDiagram
  participant W as Web
  participant A as api
  participant DB as DB
  W->>A: POST /auth/login {username,password}
  A->>DB: app_user 조회 + password_hash 검증
  alt 성공
    A->>A: JWT 발급 (claims: roles, topics)
    A->>DB: audit_log(LOGIN, SUCCEEDED)
    A-->>W: 200 {accessToken, refreshToken, user}
  else 실패
    A->>DB: audit_log(LOGIN, FAILED)
    A-->>W: 401 UNAUTHENTICATED
  end
```
- `topics` claim = 사용자 Area 서브트리 → 이후 MQTT ACL·WS 구독 범위(§mqtt 6.3).

---

## 2. 기기 등록 / 온보딩

```mermaid
sequenceDiagram
  participant W as Web(ADMIN)
  participant A as api
  participant DB as DB
  participant D as Device
  participant B as Mosquitto
  W->>A: POST /devices {code, areaId, ...}
  A->>A: buildTopic(계층+code) → mqtt_topic
  A->>DB: device INSERT (current_status=OFFLINE)
  A->>DB: audit_log(DEVICE_CREATE)
  A-->>W: 201 {device, mqttTopic}
  Note over D,B: 이후 기기 부팅 시
  D->>B: CONNECT (LWT=.../state OFFLINE retained, mqtts, user/pw)
  D->>B: publish .../state {ON} (retained, QoS1)
  B->>gateway: $share state
  gateway->>DB: current_status=ON
```

---

## 3. 텔레메트리 수집 → 대시보드 반영

```mermaid
sequenceDiagram
  participant D as Device
  participant B as Mosquitto
  participant G as gateway
  participant DB as TimescaleDB
  participant A as api
  participant W as Web
  loop 주기 측정
    D->>B: publish .../telemetry {metrics} (QoS0)
  end
  B->>G: $share telemetry
  G->>G: 메모리 버퍼 적재
  loop flush ~500ms
    G->>DB: 배치 insert(COPY) telemetry
  end
  A->>DB: 집계/다운샘플 조회
  A-->>W: /ws/realtime 차트 갱신 (≤1s)
```

---

## 4. 단일 제어 명령 — 전체 수명주기 (성공/실패/타임아웃)

```mermaid
sequenceDiagram
  participant W as Web
  participant A as api
  participant R as Redis
  participant B as Mosquitto
  participant G as gateway
  participant D as Device
  participant DB as DB
  W->>A: POST /commands {command, target}
  A->>A: RBAC(CONTROL) 확인
  A->>DB: command CREATED→PENDING + audit_log (tx)
  A->>R: SETNX cmd:{commandId} (SLA 마감)
  A->>B: publish .../cmd (QoS1, UserProps: Actor/Session/Command/Role/Time)
  A-->>W: 202 {commandId, PENDING}
  B->>D: .../cmd
  D->>B: .../cmd/ack {IN_PROGRESS}
  B->>G: $share ack
  G->>DB: IN_PROGRESS + audit_log
  alt 정상 완료
    D->>B: .../cmd/ack {SUCCEEDED}
    B->>G: ack
    G->>DB: SUCCEEDED + audit_log
    G->>R: DEL cmd:{commandId}
    D->>B: .../state {ON} retained
    G->>A: 상태 반영 → WS push
  else 기기 실패
    D->>B: .../cmd/ack {FAILED, reasonCode}
    G->>DB: FAILED + mqtt_reason_code + audit_log
  else 응답 없음(SLA 초과)
    Note over G,R: 타임아웃 스위퍼
    G->>R: 만료 cmd 조회
    G->>DB: TIMED_OUT + audit_log
  end
```

---

## 5. 그룹 / 배치 제어 (팬아웃)

```mermaid
sequenceDiagram
  participant W as Web
  participant A as api
  participant DB as DB
  participant B as Mosquitto
  W->>A: POST /device-groups/{id}/commands {command}
  A->>DB: 그룹 멤버 device 조회 (RBAC 필터)
  loop 각 멤버 device
    A->>DB: command(개별 commandId) CREATED→PENDING + audit
    A->>B: publish .../{device}/cmd (QoS1)
  end
  A-->>W: 202 {batchId, commands[]}
  Note over A: 각 명령은 §4 흐름으로 독립 수명주기·감사
```

---

## 6. 알람 발생 → 라우팅 → 에스컬레이션 → 확인

```mermaid
sequenceDiagram
  participant D as Device
  participant B as Mosquitto
  participant G as gateway
  participant DB as DB
  participant N as Notification
  participant M as Monitor
  D->>B: publish .../alarm {tier,severity,msg} (QoS2)
  B->>G: $share alarm
  G->>DB: alarm_log(state=RAISED)
  G->>DB: alarm_policy/routing 조회
  G->>N: 채널 발송(push/email/sms)
  G-->>M: /ws/realtime 알람 표시 (≤3s)
  alt 미대응 (after_sec 경과)
    G->>DB: escalation_rule 조회
    G->>N: 상위 레벨 발송
  end
  M->>api: POST /alarms/{id}/ack
  api->>DB: alarm_log(state=ACK) + alarm_action + audit_log
  opt Snooze (USER)
    M->>api: POST /alarms/{id}/snooze {until}
    api->>DB: state=SNOOZED
  end
```

---

## 7. LWT / Offline 감지

```mermaid
sequenceDiagram
  participant D as Device
  participant B as Mosquitto
  participant G as gateway
  participant DB as DB
  Note over D,B: 비정상 종료(keepalive 초과)
  B->>B: LWT 트리거
  B->>G: publish .../state {OFFLINE} retained
  G->>DB: device.current_status=OFFLINE
  G->>DB: alarm_log(OFFLINE, Reactive/Proactive)
  G-->>Web: /ws/realtime 마커 검정(Offline)
```

---

## 8. AI 추천 → HITL 승인/거절

```mermaid
sequenceDiagram
  participant AI as ai-engine
  participant A as api
  participant DB as DB
  participant H as HITL 승인자
  participant Flow as 제어 흐름(§4)
  AI->>DB: ai_recommendation 생성 (confidence, target)
  A->>A: 게이트 판정
  alt 고위험 장치 OR confidence < 임계치
    A->>DB: status=PENDING_APPROVAL
    A-->>H: /ws + 목록 노출 ("외출 감지, 전체 소등?")
    alt Approve
      H->>A: POST /recommendations/{id}/approve
      A->>DB: status=APPROVED, hitl_decision(APPROVE), ai_training_sample
      A->>Flow: POST /commands (actorType=AI, 승인자 기록)
      A->>DB: status=EXECUTED
    else Reject
      H->>A: POST /recommendations/{id}/reject
      A->>DB: status=REJECTED, hitl_decision(REJECT), ai_training_sample
    end
  else 저위험 & 고신뢰
    A->>Flow: 자동 실행(actorType=AI) + audit
    A->>DB: status=EXECUTED
  end
```
- 승인/거절은 **모두 학습 데이터**로 저장(SRS 3.5). 고위험 장치는 신뢰도와 무관하게 승인 필수.

---

## 8-cam. 알람 현장 확인 + PTZ 제어 (옵션 카메라)

```mermaid
sequenceDiagram
  participant M as Monitor
  participant A as api
  participant DB as DB
  participant MG as media-gateway
  participant B as Mosquitto
  participant G as gateway
  participant C as Camera
  Note over DB: 알람 RAISED (§6). policy.linked_camera_id 존재
  A->>DB: alarm의 커버 카메라 조회 (camera_coverage/linked)
  opt 자동 프리셋 이동
    A->>B: publish .../cam-01/cmd {ptz_goto_preset} (QoS1)
    B->>G: cmd → C
    G->>DB: command 수명주기 + audit_log
  end
  M->>A: GET /alarms/{id}/cameras
  A-->>M: 카메라 목록
  M->>A: GET /cameras/cam-01/stream
  A->>A: 권한 확인 → 단기 서명 URL 발급
  A-->>M: {webrtc/hls URL}
  M->>MG: 스트림 연결 (WebRTC/HLS, MQTT 아님)
  MG-->>M: 라이브 영상
  opt 수동 PTZ 조작
    M->>A: POST /cameras/cam-01/ptz {pan,tilt,zoom}
    A->>B: .../cam-01/cmd {ptz_move}
    B->>G: cmd → C
    G->>DB: SUCCEEDED + audit_log
  end
```
- PTZ 제어는 §4 명령 수명주기·감사를 그대로 따른다. **영상은 미디어 경로**로 분리.

## 9. 스케줄러 트리거 → 명령

```mermaid
sequenceDiagram
  participant S as scheduler
  participant DB as DB
  participant A as api/gateway
  Note over S: cron/one-time/event 도래
  S->>DB: scheduler 조회 (enabled)
  S->>DB: schedule_run(FIRED)
  S->>A: 명령 발행 (§4 흐름, payload=scheduler.payload)
  A->>DB: command + audit_log
  alt 대상/권한 이상
    S->>DB: schedule_run(SKIPPED/FAILED)
  end
```

---

## 10. 커버리지 노트

| 흐름 | 다이어그램 |
|---|---|
| 인증 | §1 |
| 기기 온보딩 | §2 |
| 텔레메트리 | §3 |
| 제어(성공/실패/타임아웃) | §4 |
| 배치 제어 | §5 |
| 알람/에스컬레이션 | §6 |
| Offline/LWT | §7 |
| AI/HITL | §8 |
| 알람 현장확인·PTZ(옵션) | §8-cam |
| 스케줄러 | §9 |

미해결/후속(부록 A.2): 외부 연동(BMS/EMS/Voice/Vision), 멀티테넌트 인증 플로우, 알림 채널 provider별 시퀀스.
