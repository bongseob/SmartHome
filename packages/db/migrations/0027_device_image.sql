-- Up Migration
-- 기기 사용자 지정 이미지 — 관제 화면 마커·기기 정보 모달에서 실제 기기 사진을 보여주기
-- 위한 참조(2026-07-20 요청). area.image_id와 동일하게 기존 image 라이브러리를 재사용한다
-- (전용 테이블 신설 없음). 이미지 삭제 시 SET NULL로 해제(area 패턴과 동일).
ALTER TABLE device
  ADD COLUMN image_id uuid REFERENCES image(id) ON DELETE SET NULL;

-- Down Migration
ALTER TABLE device
  DROP COLUMN IF EXISTS image_id;
