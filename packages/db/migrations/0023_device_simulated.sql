-- Up Migration
-- 실기기 없이 개발/데모하기 위한 시뮬레이터 응답 대상 여부(true=기본). device-simulator의
-- MockResponder는 simulated=true인 device.code의 cmd에만 대신 응답한다 — 실기기를 연결하면
-- 이 값을 false로 바꿔 목 응답을 끄면 된다(토픽/기기 row는 그대로 유지, 마이그레이션 불필요).
-- monitoring_visible/enabled(0021)와 달리 관제 화면 노출 여부와는 무관 — 화면에는 계속 보이고
-- "가상" 표시만 붙는다.
ALTER TABLE device
  ADD COLUMN simulated boolean NOT NULL DEFAULT true;

-- Down Migration
ALTER TABLE device
  DROP COLUMN IF EXISTS simulated;
