-- Up Migration
-- 프로비저닝 · 펌웨어 OTA (docs/erd.md I, device-lifecycle-ota.md)
CREATE TABLE device_credential (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id   uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  cred_type   credential_type NOT NULL,
  secret_hash text NOT NULL,
  status      text NOT NULL DEFAULT 'ACTIVE',
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz
);
CREATE INDEX idx_credential_device ON device_credential(device_id);

CREATE TABLE firmware_artifact (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_type text NOT NULL,
  version     text NOT NULL,
  url         text NOT NULL,
  sha256      text NOT NULL,
  signature   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_type, version)
);

CREATE TABLE ota_job (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firmware_id uuid NOT NULL REFERENCES firmware_artifact(id) ON DELETE RESTRICT,
  target_type target_type NOT NULL,
  target_id   uuid NOT NULL,
  strategy    ota_strategy NOT NULL DEFAULT 'STAGED',
  status      ota_job_status NOT NULL DEFAULT 'CREATED',
  created_by  uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ota_target (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id     uuid NOT NULL REFERENCES ota_job(id) ON DELETE CASCADE,
  device_id  uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  status     ota_status NOT NULL DEFAULT 'PENDING',
  command_id text REFERENCES command(command_id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ota_target_job ON ota_target(job_id);

-- Down Migration
DROP TABLE IF EXISTS ota_target, ota_job, firmware_artifact, device_credential;
