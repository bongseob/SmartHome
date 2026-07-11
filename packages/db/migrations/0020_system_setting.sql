-- Up Migration
-- 시스템 설정값 (docs/srs-lighting-control-addendum.md §1·§4·§5).
-- 순차 제어 간격·서버↔보드 엔드포인트 등 "코드에 하드코딩하지 않는" 운영 설정을 key/value로 관리.
CREATE TABLE system_setting (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_by  uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 레거시 기본값 시드(값은 운영 중 변경 가능). 하드코딩 금지 원칙에 따라 여기서만 기본값을 둔다.
INSERT INTO system_setting (key, value, description) VALUES
  ('control.sequential_interval_ms', '1500'::jsonb,
   '그룹 일괄 제어 시 명령 간 순차 발행 간격(ms). 돌입전류 완화(addendum §5).'),
  ('legacy.server_endpoint', '{"host":"192.168.10.5","port":12005}'::jsonb,
   '레거시 감시장비(보드) 통신용 서버측 리슨 주소/포트. 엣지 브리지 전용(addendum §1·§4).'),
  ('legacy.board_default_port', '20000'::jsonb,
   '레거시 감시장비(Gateway) 기본 통신 포트(addendum §3.1).')
ON CONFLICT (key) DO NOTHING;

-- Down Migration
DROP TABLE IF EXISTS system_setting;
