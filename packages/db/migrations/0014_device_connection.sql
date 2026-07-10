-- Up Migration
-- Device↔Gateway 연결 프로토콜 (SRS 2.1.2·3.1.1, PROJECT_RULES 부록 A.1, 2026-07-10 합의)
-- Gateway↔플랫폼 구간은 그대로 MQTT 전용이다 — 이 컬럼은 그걸 대체하지 않고, 어떤 물리 프로토콜의
-- 기기를 어떤 Gateway가 브리징하는지 기록/관리하는 용도다.
CREATE TYPE device_connection_protocol AS ENUM (
  'TCP_IP', 'SERIAL', 'MODBUS_TCP', 'MODBUS_RTU', 'ZIGBEE', 'ZWAVE'
);

ALTER TABLE device
  ADD COLUMN connection_protocol device_connection_protocol,
  ADD COLUMN connection_config jsonb;

-- Down Migration
ALTER TABLE device
  DROP COLUMN IF EXISTS connection_config,
  DROP COLUMN IF EXISTS connection_protocol;
DROP TYPE IF EXISTS device_connection_protocol;
