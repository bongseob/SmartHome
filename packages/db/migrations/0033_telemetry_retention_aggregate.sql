-- Up Migration
-- telemetry 보존/집계 정책(코드 리뷰 P2 #16). 합의된 수치: 원본 1년 보관 후 삭제(retention
-- policy), 시간당 집계는 5년 이상 유지(continuous aggregate) — iot_smarthome_srs.md §6,
-- docs/erd.md, PROJECT_RULES.md에 동일하게 명시돼 있다.
-- 0010_telemetry.sql과 동일하게, timescaledb 확장이 실제로 켜져 있을 때만(프로덕션 대상)
-- 적용한다 — 개발 postgres:15에는 확장이 없어 hypertable조차 아니므로 이 정책들도 조건부로
-- 건너뛴다(그 환경에서는 이 마이그레이션이 사실상 no-op).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    -- 원본 telemetry: 1년 경과분은 청크 단위로 자동 삭제.
    PERFORM add_retention_policy('telemetry', INTERVAL '1 year', if_not_exists => TRUE);

    -- 시간당 집계(continuous aggregate) — device_id/metric별 1시간 버킷.
    -- value_text(문자열 상태값 등)는 last()로 해당 버킷의 최신값만 남긴다.
    CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_hourly
    WITH (timescaledb.continuous) AS
    SELECT
      device_id,
      metric,
      time_bucket('1 hour', "time") AS bucket,
      count(*) AS sample_count,
      avg(value_num) AS avg_value,
      min(value_num) AS min_value,
      max(value_num) AS max_value,
      last(value_num, "time") AS last_value_num,
      last(value_text, "time") AS last_value_text
    FROM telemetry
    GROUP BY device_id, metric, bucket
    WITH NO DATA;

    -- 집계를 주기적으로 갱신(매시간, 최근 1~3시간 구간을 다시 계산 — 늦게 도착하는 telemetry 반영).
    PERFORM add_continuous_aggregate_policy('telemetry_hourly',
      start_offset => INTERVAL '3 hours',
      end_offset => INTERVAL '1 hour',
      schedule_interval => INTERVAL '1 hour',
      if_not_exists => TRUE);

    -- 집계 데이터는 원본보다 훨씬 길게, 5년 이상 유지.
    PERFORM add_retention_policy('telemetry_hourly', INTERVAL '5 years', if_not_exists => TRUE);
  END IF;
END$$;

-- Down Migration
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM remove_retention_policy('telemetry_hourly', if_exists => TRUE);
    DROP MATERIALIZED VIEW IF EXISTS telemetry_hourly;
    PERFORM remove_retention_policy('telemetry', if_exists => TRUE);
  END IF;
END$$;
