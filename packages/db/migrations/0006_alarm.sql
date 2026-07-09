-- Up Migration
-- 알람 (docs/erd.md E, SRS 3.3)
CREATE TABLE notification_channel (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type   channel_type NOT NULL,
  name   text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE alarm_policy (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  tier                alarm_tier NOT NULL,
  target_type         target_type NOT NULL,
  target_id           uuid,
  metric              text,
  operator            text,
  threshold_value     numeric,
  duration_sec        integer,
  severity            severity NOT NULL DEFAULT 'WARNING',
  enabled             boolean NOT NULL DEFAULT true,
  linked_camera_id    uuid REFERENCES camera(device_id) ON DELETE SET NULL,
  auto_goto_preset_id uuid REFERENCES camera_preset(id) ON DELETE SET NULL,
  created_by          uuid REFERENCES app_user(id) ON DELETE SET NULL
);

CREATE TABLE alarm_policy_channel (
  policy_id  uuid NOT NULL REFERENCES alarm_policy(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES notification_channel(id) ON DELETE CASCADE,
  PRIMARY KEY (policy_id, channel_id)
);

CREATE TABLE escalation_rule (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id         uuid NOT NULL REFERENCES alarm_policy(id) ON DELETE CASCADE,
  level             integer NOT NULL,
  after_sec         integer NOT NULL,
  notify_channel_id uuid REFERENCES notification_channel(id) ON DELETE SET NULL,
  notify_role       app_role
);

CREATE TABLE alarm_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  policy_id     uuid REFERENCES alarm_policy(id) ON DELETE SET NULL,
  device_id     uuid REFERENCES device(id) ON DELETE SET NULL,
  tier          alarm_tier NOT NULL,
  severity      severity NOT NULL,
  message       text,
  state         alarm_state NOT NULL DEFAULT 'RAISED',
  raised_at     timestamptz NOT NULL DEFAULT now(),
  snoozed_until timestamptz,
  resolved_at   timestamptz
);
CREATE INDEX idx_alarm_state ON alarm_log(state);
CREATE INDEX idx_alarm_device ON alarm_log(device_id);

CREATE TABLE alarm_action (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alarm_id    bigint NOT NULL REFERENCES alarm_log(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES app_user(id) ON DELETE SET NULL,
  action_type alarm_action_type NOT NULL,
  note        text,
  ts          timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE IF EXISTS alarm_action, alarm_log, escalation_rule, alarm_policy_channel, alarm_policy, notification_channel;
