-- Up Migration
-- 차단기(Device) 조명 도메인 속성 (docs/srs-lighting-control-addendum.md §3.2).
-- RMU(소속 감시장비)는 기존 device.gateway_id(self-FK)로, 버스 주소(Address, 레거시 06~)는
-- 기존 device.connection_config(jsonb, 마이그레이션 0014)로 흡수한다 — 여기서는 신규 컬럼만 추가.
ALTER TABLE device
  ADD COLUMN load_class  load_class,   -- 부하 구분(일반/비상/예비). RESERVE는 관제 화면 미표시.
  ADD COLUMN description text;         -- 차단기 설명

-- Down Migration
ALTER TABLE device
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS load_class;
