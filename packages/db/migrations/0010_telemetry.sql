-- Up Migration
-- 텔레메트리 (docs/erd.md H). 프로덕션 대상은 TimescaleDB hypertable.
-- 개발 postgres:15 에는 timescaledb 확장이 없으므로, 확장이 있을 때만 hypertable 로 변환한다.
CREATE TABLE telemetry (
  "time"     timestamptz NOT NULL,
  device_id  uuid NOT NULL,
  metric     text NOT NULL,
  value_num  double precision,
  value_text text,
  quality    smallint
);
CREATE INDEX idx_telemetry_device_time ON telemetry(device_id, "time" DESC);
CREATE INDEX idx_telemetry_time ON telemetry("time" DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') THEN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
    PERFORM create_hypertable('telemetry', 'time', if_not_exists => TRUE, migrate_data => TRUE);
    -- 보존 정책(원본 1년)은 TimescaleDB 정책으로 별도 설정 (add_retention_policy)
  END IF;
END$$;

-- Down Migration
DROP TABLE IF EXISTS telemetry;
