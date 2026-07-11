-- Up Migration
-- 휴일 관리 (docs/srs-lighting-control-addendum.md §7). 타임프로그램의 공휴일 스케줄 판정에 사용.
-- 음력 공휴일(설날·추석)은 lunar_solar='LUNAR'로 등록하고 스케줄 판정 시 양력으로 변환한다.
-- 연휴는 해당되는 모든 날짜를 각각 등록한다(범위 자동확장 없음).
CREATE TABLE holiday (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month       smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  day         smallint NOT NULL CHECK (day BETWEEN 1 AND 31),
  lunar_solar lunar_solar NOT NULL DEFAULT 'SOLAR',
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (month, day, lunar_solar, name)
);

-- Down Migration
DROP TABLE IF EXISTS holiday;
