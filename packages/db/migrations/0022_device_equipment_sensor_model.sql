-- Up Migration
-- 기기 관리 운영 모델: 감시장비(RMU 등) 1대에 여러 개별 센서 채널이 붙는 구조.
-- 기존 device_category는 기술 분류로 유지하고, device_role이 관리 화면의 1차 구분이 된다.
CREATE TYPE device_role AS ENUM ('MONITORING_EQUIPMENT', 'SENSOR');
CREATE TYPE sensor_signal_type AS ENUM ('DIGITAL', 'ANALOG');
CREATE TYPE sensor_io_type AS ENUM ('DI', 'DO', 'AI', 'AO');

ALTER TABLE device
  ADD COLUMN device_role device_role NOT NULL DEFAULT 'SENSOR',
  ADD COLUMN parent_device_id uuid REFERENCES device(id) ON DELETE SET NULL,
  ADD COLUMN sensor_signal_type sensor_signal_type,
  ADD COLUMN sensor_io_type sensor_io_type,
  ADD COLUMN channel_address text,
  ADD COLUMN terminal_block text;

CREATE INDEX idx_device_parent_device ON device(parent_device_id);
CREATE INDEX idx_device_role ON device(device_role);

UPDATE device
SET device_role = 'MONITORING_EQUIPMENT'
WHERE category = 'GATEWAY';

UPDATE device
SET sensor_signal_type = COALESCE(sensor_signal_type, 'DIGITAL'),
    sensor_io_type = COALESCE(sensor_io_type, 'DI')
WHERE device_role = 'SENSOR';

ALTER TABLE device
  ADD CONSTRAINT chk_device_role_parent
  CHECK (
    (device_role = 'MONITORING_EQUIPMENT' AND parent_device_id IS NULL)
    OR device_role = 'SENSOR'
  ),
  ADD CONSTRAINT chk_sensor_metadata
  CHECK (
    device_role = 'MONITORING_EQUIPMENT'
    OR (sensor_signal_type IS NOT NULL AND sensor_io_type IS NOT NULL)
  );

-- Down Migration
ALTER TABLE device
  DROP CONSTRAINT IF EXISTS chk_sensor_metadata,
  DROP CONSTRAINT IF EXISTS chk_device_role_parent;

DROP INDEX IF EXISTS idx_device_role;
DROP INDEX IF EXISTS idx_device_parent_device;

ALTER TABLE device
  DROP COLUMN IF EXISTS terminal_block,
  DROP COLUMN IF EXISTS channel_address,
  DROP COLUMN IF EXISTS sensor_io_type,
  DROP COLUMN IF EXISTS sensor_signal_type,
  DROP COLUMN IF EXISTS parent_device_id,
  DROP COLUMN IF EXISTS device_role;

DROP TYPE IF EXISTS sensor_io_type;
DROP TYPE IF EXISTS sensor_signal_type;
DROP TYPE IF EXISTS device_role;
