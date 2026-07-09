-- Up Migration
-- 사용자·권한 (docs/erd.md C)
CREATE TABLE app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name  text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_role (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role    app_role NOT NULL,
  PRIMARY KEY (user_id, role)
);

CREATE TABLE user_area_permission (
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  area_id      uuid NOT NULL REFERENCES area(id) ON DELETE CASCADE,
  access_level access_level NOT NULL DEFAULT 'VIEW',
  PRIMARY KEY (user_id, area_id)
);

CREATE TABLE user_device_permission (
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  device_id    uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  access_level access_level NOT NULL DEFAULT 'VIEW',
  PRIMARY KEY (user_id, device_id)
);

CREATE TABLE user_group_permission (
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  group_id     uuid NOT NULL REFERENCES device_group(id) ON DELETE CASCADE,
  access_level access_level NOT NULL DEFAULT 'VIEW',
  PRIMARY KEY (user_id, group_id)
);

-- floor_map/area 의 감사용 FK(생성자) 보강
ALTER TABLE floor_map ADD CONSTRAINT fk_floor_map_uploader
  FOREIGN KEY (uploaded_by) REFERENCES app_user(id) ON DELETE SET NULL;
ALTER TABLE area ADD CONSTRAINT fk_area_creator
  FOREIGN KEY (created_by) REFERENCES app_user(id) ON DELETE SET NULL;

-- Down Migration
ALTER TABLE area DROP CONSTRAINT IF EXISTS fk_area_creator;
ALTER TABLE floor_map DROP CONSTRAINT IF EXISTS fk_floor_map_uploader;
DROP TABLE IF EXISTS user_group_permission, user_device_permission, user_area_permission, user_role, app_user;
