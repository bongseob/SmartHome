-- Up Migration
-- 기기·그룹·카메라 (docs/erd.md B, B-cam)
CREATE TABLE device (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE,
  name             text NOT NULL,
  category         device_category NOT NULL DEFAULT 'DEVICE',
  device_type      text,
  manufacturer     text,
  model            text,
  firmware_version text,
  mqtt_topic       text NOT NULL UNIQUE,
  current_status   device_status NOT NULL DEFAULT 'OFFLINE',
  lifecycle_status device_lifecycle NOT NULL DEFAULT 'REGISTERED',
  area_id          uuid REFERENCES area(id) ON DELETE SET NULL,
  pos_x            numeric,
  pos_y            numeric,
  gateway_id       uuid REFERENCES device(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_device_area ON device(area_id);
CREATE INDEX idx_device_category ON device(category);

CREATE TABLE device_group (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE,
  name         text NOT NULL,
  is_dynamic   boolean NOT NULL DEFAULT false,
  dynamic_rule jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE device_group_mapping (
  device_id uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  group_id  uuid NOT NULL REFERENCES device_group(id) ON DELETE CASCADE,
  PRIMARY KEY (device_id, group_id)
);

-- 카메라 (옵션) — device 1:1 확장
CREATE TABLE camera (
  device_id      uuid PRIMARY KEY REFERENCES device(id) ON DELETE CASCADE,
  protocol       camera_protocol NOT NULL,
  stream_url     text NOT NULL,
  onvif_endpoint text,
  is_ptz         boolean NOT NULL DEFAULT false,
  resolution     text,
  fov_deg        numeric,
  heading_deg    numeric
);

CREATE TABLE camera_preset (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_id  uuid NOT NULL REFERENCES camera(device_id) ON DELETE CASCADE,
  name       text NOT NULL,
  pan        numeric,
  tilt       numeric,
  zoom       numeric,
  created_by uuid
);

CREATE TABLE camera_coverage (
  camera_id uuid NOT NULL REFERENCES camera(device_id) ON DELETE CASCADE,
  area_id   uuid NOT NULL REFERENCES area(id) ON DELETE CASCADE,
  PRIMARY KEY (camera_id, area_id)
);

-- Down Migration
DROP TABLE IF EXISTS camera_coverage, camera_preset, camera, device_group_mapping, device_group, device;
