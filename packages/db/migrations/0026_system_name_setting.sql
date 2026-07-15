-- Up Migration
-- 시스템 표시 이름 — 로그인 화면·상단 헤더·브라우저 탭 제목에 쓰인다. 지금까지는 프론트에
-- "SmartHome 관제"로 하드코딩돼 있었는데, 관리자가 "시스템 기본정보" 화면에서 바꿀 수 있도록
-- system_setting에 추가한다(2026-07-15 요청).
INSERT INTO system_setting (key, value, description) VALUES
  ('system.name', '"SmartHome 관제"'::jsonb, '로그인 화면·상단 헤더·브라우저 탭에 표시되는 시스템 이름')
ON CONFLICT (key) DO NOTHING;

-- Down Migration
DELETE FROM system_setting WHERE key = 'system.name';
