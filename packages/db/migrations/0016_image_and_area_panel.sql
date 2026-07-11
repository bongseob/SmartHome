-- Up Migration
-- 이미지 라이브러리 + 분전반(Panel형 Area) (docs/srs-lighting-control-addendum.md §2).
-- 결정(2026-07-11): 재사용 이미지는 신규 image 테이블로 관리. 분전반은 area의 한 종류로
-- 모델링해 UNS 6계층을 유지한다(PROJECT_RULES §2 토픽 규칙 불변).

-- 재사용 이미지 라이브러리 (레거시 이미지관리: ID + 이미지이름). 로컬 파일시스템 저장(부록 A.1).
CREATE TABLE image (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  image_url   text NOT NULL UNIQUE,
  width_px    integer,
  height_px   integer,
  uploaded_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

-- 분전반형 Area: 유형 구분 + 배경이미지(라이브러리 참조) + 표시 좌표. 기존 area는 ROOM 기본값 유지.
ALTER TABLE area
  ADD COLUMN kind     area_kind NOT NULL DEFAULT 'ROOM',
  ADD COLUMN image_id uuid REFERENCES image(id) ON DELETE SET NULL,
  ADD COLUMN pos_x    numeric,
  ADD COLUMN pos_y    numeric;

-- 지역(floor) 배경 표시 좌표(레거시 지역관리 POS-X/POS-Y). 배경이미지는 기존 floor_map을 사용.
ALTER TABLE floor
  ADD COLUMN pos_x numeric,
  ADD COLUMN pos_y numeric;

-- Down Migration
ALTER TABLE floor
  DROP COLUMN IF EXISTS pos_y,
  DROP COLUMN IF EXISTS pos_x;
ALTER TABLE area
  DROP COLUMN IF EXISTS pos_y,
  DROP COLUMN IF EXISTS pos_x,
  DROP COLUMN IF EXISTS image_id,
  DROP COLUMN IF EXISTS kind;
DROP TABLE IF EXISTS image;
