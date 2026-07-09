-- Up Migration
-- 명령·감사 (docs/erd.md D, SRS 4.3)
CREATE TABLE command (
  command_id       text PRIMARY KEY,               -- 전역 유일 · 멱등성 키
  session_id       text NOT NULL,
  actor_type       actor_type NOT NULL,
  actor_id         uuid REFERENCES app_user(id) ON DELETE SET NULL,
  role             text,
  target_type      target_type NOT NULL,
  target_id        uuid NOT NULL,
  command          text NOT NULL,
  payload          jsonb,
  status           execution_status NOT NULL DEFAULT 'CREATED',
  mqtt_reason_code integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_command_status ON command(status);
CREATE INDEX idx_command_target ON command(target_type, target_id);

-- Audit_Log: SRS 4.3.2 컬럼 고정. 명령 전이뿐 아니라 로그인/권한변경/스케줄러/알람승인도 기록.
-- append-only 로 운영(보존 5년+). Log ID / Timestamp / Actor Type / ...
CREATE TABLE audit_log (
  log_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts               timestamptz NOT NULL DEFAULT now(),
  actor_type       actor_type NOT NULL,
  actor_id         text,
  target_type      text,
  target_id        text,
  command          text,
  reason           text,
  execution_status execution_status,
  mqtt_reason_code integer,
  session_id       text,
  command_id       text REFERENCES command(command_id) ON DELETE SET NULL
);
CREATE INDEX idx_audit_ts ON audit_log(ts);
CREATE INDEX idx_audit_command ON audit_log(command_id);
CREATE INDEX idx_audit_actor ON audit_log(actor_type, actor_id);

-- Down Migration
DROP TABLE IF EXISTS audit_log, command;
