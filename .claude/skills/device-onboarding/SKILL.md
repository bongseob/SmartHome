---
name: device-onboarding
description: Onboard a new device or sensor type into the SmartHome system — DB entity, UNS topic wiring, telemetry mapping to TimescaleDB, status state model, LWT, retained state, and floor-map marker. Use when adding a new Device Type, Sensor, or Gateway.
---

# 새 Device / Sensor / Gateway 타입 온보딩

기기 타입을 시스템에 편입할 때 빠지기 쉬운 항목을 모두 챙기는 절차.
근거: [CLAUDE.md](../../../CLAUDE.md) §2~§3·§8, SRS 3.1 / 3.2 / 4.1.

## 이 스킬을 쓰는 때
- 새 Device Type / Sensor / Gateway를 등록할 때
- 기존 기기에 새 텔레메트리 채널·제어 명령을 추가할 때

## 체크리스트
### 1. 데이터 모델 (PostgreSQL)
- [ ] Device 필수 속성: `deviceId, name, type, manufacturer, model, firmwareVersion, mqttTopic, currentStatus`
- [ ] 위치 `(x, y)` + Area 매핑, Device↔Group **N:M** (`Device_Group_Mapping`)
- [ ] (선택) Device↔Gateway 연결 프로토콜: `connectionProtocol`(`TCP_IP`/`SERIAL`/`MODBUS_TCP`/
      `MODBUS_RTU`/`ZIGBEE`/`ZWAVE`) + `connectionConfig`(jsonb, 프로토콜별 파라미터 — 예:
      TCP_IP·MODBUS_TCP는 host/port, SERIAL·MODBUS_RTU는 COM포트/보율, Modbus는 Unit ID 추가).
      **이 필드는 Gateway가 실제 기기와 연결되는 방식을 기록할 뿐이다 — Gateway↔플랫폼 구간은
      항상 MQTT다(대체 금지, PROJECT_RULES 부록 A.1).** enum은 `packages/contracts`에서만 정의.
- [ ] 마이그레이션 파일로만 스키마 변경 (수동 DDL 금지)

### 2. UNS 토픽 배선 (하드코딩 금지, `buildTopic()`)
- [ ] state: `.../{device}/state` — **Retained + QoS 1**
- [ ] telemetry: `.../{device}/telemetry` — **QoS 0, retained 아님**
- [ ] cmd / cmd/ack: **QoS 1**
- [ ] alarm: **QoS 2**

### 3. 연결 규칙
- [ ] **LWT 필수** 등록: `state` 토픽에 `{ "status":"OFFLINE", "ts":<ms> }` retained
- [ ] 정상 상태값 게시 시 retained 로 최신 상태 유지

### 4. 상태 모델 (Floor Map 색상 — SRS 3.2)
`ON=녹색, OFF=회색, Warning=노란색, Alarm=빨간색, Offline=검정`.
- [ ] currentStatus enum을 `packages/contracts`에 정의, 프론트 마커 색상과 매핑

### 5. 텔레메트리 (TimescaleDB)
- [ ] telemetry payload → hypertable 컬럼 매핑
- [ ] 보존 정책: 원본 1년 / continuous aggregate 5년+

### 6. 프론트 (Floor Map)
- [ ] Konva 마커 등록, 선택 시 Drawer: 현재상태·최근이벤트·최근알람·최근제어·센서데이터·설정

### 7. 알람 연동
- [ ] 이 기기에 필요한 임계치/알람이 있으면 → `alarm-rule` 스킬로 정책 정의

### 8. PTZ 카메라(옵션, category=CAMERA)
- [ ] `camera` 확장행: protocol(RTSP/WEBRTC/HLS/ONVIF), stream_url, is_ptz, heading/fov
- [ ] PTZ 제어는 새 토픽이 아니라 `/cmd` 재사용: `ptz_move / ptz_goto_preset / ptz_stop`
      (수명주기·Audit_Log는 `mqtt-command` 스킬과 동일)
- [ ] `camera_preset` 정의, `camera_coverage`로 커버 Area 매핑
- [ ] **영상 스트림은 MQTT 아님** — media-gateway(WebRTC/HLS) + 서명 URL 경로로 분리
- [ ] 알람 현장 확인 연동 필요 시 `alarm_policy.linked_camera_id`/`auto_goto_preset_id`
- 설계 근거: docs/{erd,mqtt-topic-design,api-spec,architecture,ui-ux-design}.md 의 카메라/PTZ 절

## 안티패턴
- LWT 없이 연결 (offline 감지 불가)
- telemetry 토픽에 retained
- 상태값을 Audit_Log에, 제어이력을 Telemetry에 저장 (로그 계층 혼용)
- 카메라 영상 스트림을 MQTT로 전송 (브로커 대역폭 오염) — 미디어 경로 사용
