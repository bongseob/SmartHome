-- Up Migration
-- 스케줄러 (docs/erd.md F, SRS 3.4)
CREATE TABLE scheduler (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  target_type   target_type NOT NULL,
  target_id     uuid NOT NULL,
  schedule_type schedule_type NOT NULL,
  run_at        timestamptz,
  cron_expr     text,
  days_of_week  integer[],
  day_of_month  integer,
  event_trigger jsonb,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled       boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES app_user(id) ON DELETE SET NULL
);

CREATE TABLE schedule_run (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scheduler_id uuid NOT NULL REFERENCES scheduler(id) ON DELETE CASCADE,
  fired_at     timestamptz NOT NULL DEFAULT now(),
  command_id   text REFERENCES command(command_id) ON DELETE SET NULL,
  status       schedule_run_status NOT NULL
);

-- Down Migration
DROP TABLE IF EXISTS schedule_run, scheduler;
