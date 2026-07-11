-- Up Migration
-- 타임프로그램(정기 운영 스케줄 템플릿) + 그룹 매핑 (docs/srs-lighting-control-addendum.md §6.2·§6.3).
-- 시스템 전체 최대 300개. 각 프로그램은 요일별(일~토) 및 공휴일별 ON/OFF 슬롯을 가진다.
-- day_of_week는 기존 scheduler.days_of_week 컨벤션과 동일(0=일 ~ 6=토). 공휴일 슬롯은 is_holiday=true.

CREATE TABLE time_program (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_no smallint NOT NULL UNIQUE CHECK (program_no BETWEEN 1 AND 300),
  name       text NOT NULL,
  enabled    boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 프로그램의 개별 운영 슬롯: (요일 또는 공휴일) × 시각 × ON/OFF.
CREATE TABLE time_program_slot (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  time_program_id uuid NOT NULL REFERENCES time_program(id) ON DELETE CASCADE,
  day_of_week     smallint CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=일 ~ 6=토, 공휴일 슬롯이면 NULL
  is_holiday      boolean NOT NULL DEFAULT false,
  at_time         time NOT NULL,
  power_on        boolean NOT NULL,
  -- 요일 슬롯이면 day_of_week 지정+is_holiday=false, 공휴일 슬롯이면 day_of_week=NULL+is_holiday=true
  CONSTRAINT time_program_slot_day_xor CHECK (
    (is_holiday = false AND day_of_week IS NOT NULL) OR
    (is_holiday = true  AND day_of_week IS NULL)
  )
);
CREATE INDEX idx_time_program_slot_program ON time_program_slot(time_program_id);

-- 스케줄 등록 관리: 타임프로그램 ↔ Device_Group N:M 매핑.
CREATE TABLE time_program_group (
  time_program_id uuid NOT NULL REFERENCES time_program(id) ON DELETE CASCADE,
  group_id        uuid NOT NULL REFERENCES device_group(id) ON DELETE CASCADE,
  PRIMARY KEY (time_program_id, group_id)
);

-- Down Migration
DROP TABLE IF EXISTS time_program_group;
DROP TABLE IF EXISTS time_program_slot;
DROP TABLE IF EXISTS time_program;
