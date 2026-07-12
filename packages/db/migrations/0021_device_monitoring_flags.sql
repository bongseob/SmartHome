-- Up Migration
-- 모니터링 표시/사용 여부. 숨김 또는 미사용 기기는 도면 관제 화면에서 제외하고,
-- 관리자 기기 목록에서는 다시 복구할 수 있도록 보존한다.
ALTER TABLE device
  ADD COLUMN monitoring_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN enabled boolean NOT NULL DEFAULT true;

CREATE INDEX idx_device_monitoring_active
  ON device(area_id)
  WHERE monitoring_visible = true
    AND enabled = true
    AND lifecycle_status <> 'DECOMMISSIONED';

-- Down Migration
DROP INDEX IF EXISTS idx_device_monitoring_active;

ALTER TABLE device
  DROP COLUMN IF EXISTS enabled,
  DROP COLUMN IF EXISTS monitoring_visible;
