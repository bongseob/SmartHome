---
name: mqtt-command
description: Implement a new MQTT control command end-to-end for the SmartHome system — standard JSON payload, MQTT5 User Properties, QoS, the CREATED→PENDING→IN_PROGRESS→SUCCEEDED/FAILED/TIMED_OUT lifecycle, and Audit_Log writes on every transition. Use whenever adding, changing, or reviewing any device/group control command.
---

# 새 MQTT 제어 명령 구현

SmartHome 시스템에서 device/group을 제어하는 명령을 **누락 없이** 구현하기 위한 절차.
근거 규칙은 [CLAUDE.md](../../../CLAUDE.md) §2~§4, SRS 3.1.3 / 4.3.

## 이 스킬을 쓰는 때
- 새 `command`(turn_on, set_temperature, lock 등)를 추가할 때
- 배치 제어(Batch Control) 명령을 만들 때
- 기존 명령이 감사/수명주기 규칙을 지키는지 리뷰할 때

## 반드시 지킬 불변식 (하나라도 빠지면 버그)
1. **UNS 토픽**은 하드코딩하지 않고 `buildTopic()`으로 생성. 제어는 `.../{device}/cmd`, **QoS 1**.
2. **Payload 필수 필드**: `sessionId`, `commandId`, `command`, `target`, `timestamp`.
   `commandId`는 전역 유일 + **멱등성 키**. 동일 commandId 재수신 시 재실행 금지.
3. **메타데이터는 payload가 아닌 MQTT5 User Properties**로:
   `Actor_ID`, `Session_ID`, `Command_ID`, `Role`, `Request_Time`.
4. **수명주기 상태 머신**을 그대로 구현:
   `CREATED → PENDING → IN_PROGRESS → SUCCEEDED | FAILED | TIMED_OUT`.
   상태를 건너뛰지 않는다.
5. **모든 상태 전이마다 Audit_Log 1행 기록**. 스키마는 CLAUDE.md §4.4 컬럼 고정.
   실패 시 `MQTT Reason Code` 필수.
6. ack 미수신 타임아웃 시 `TIMED_OUT` 전이 + 기록.
7. 실행 전 **RBAC/ACL 검사**: actor가 target device의 Area에 대한 제어 권한이 있는지.

## 구현 체크리스트
- [ ] `packages/contracts`에 command 이름 enum과 payload 타입 추가 (양쪽 공유)
- [ ] 명령 발행기: 토픽·QoS·User Properties·payload 구성, publish 전 `CREATED`→`PENDING` 기록
- [ ] `cmd/ack` 구독 핸들러: `IN_PROGRESS`→`SUCCEEDED`/`FAILED` 전이 + 기록
- [ ] 타임아웃 워커: SLA 초과 시 `TIMED_OUT` 기록
- [ ] 멱등성: commandId 중복 저장소(예: Redis) 체크
- [ ] 권한 가드 + 고위험 장치면 HITL 필요 여부 확인 (→ `hitl-recommendation` 스킬)
- [ ] 단위 테스트: 정상/실패/타임아웃/중복 4경로 모두 Audit_Log 검증

## 안티패턴 (금지)
- Audit_Log 없이 publish
- actor/role을 payload에 중복 기재
- 제어 토픽에 retained=true
- 상태 없이 곧바로 SUCCEEDED 기록
