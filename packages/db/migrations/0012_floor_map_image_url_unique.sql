-- Up Migration
-- floor_map.image_url UNIQUE 제약조건 추가 (seed 멱등성 확보)
-- 근거: PROJECT_RULES §11 — 기존 마이그레이션 수정 대신 새 파일 추가
ALTER TABLE floor_map
  ADD CONSTRAINT uq_floor_map_image_url UNIQUE (image_url);

-- Down Migration
ALTER TABLE floor_map
  DROP CONSTRAINT IF EXISTS uq_floor_map_image_url;
