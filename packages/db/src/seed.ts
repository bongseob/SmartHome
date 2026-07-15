import { buildDeviceBase } from "@smarthome/contracts";
import { pbkdf2Sync } from "node:crypto";
import { closePool, query } from "./pool.js";

/**
 * 개발용 시드 (idempotent). 대시보드 검증용으로 지역 1개, 기기 3대, 배경 이미지 포함.
 * area가 1차 관리 단위이고 floor는 area가 공유하는 층 태그일 뿐이라는 관례(2026-07-15 합의)에
 * 따라, 배경 이미지는 area.image_id가 직접 가진다(image 라이브러리 row를 만들어 연결). 거실/침실
 * 구분은 area가 아니라 배치 좌표(pos_x/pos_y)로만 표현한다.
 * thermostat-01 은 device-simulator M1/M2 와 정합.
 * fleet 정의 단일 소스화는 후속(docs/device-simulator.md §13).
 */
async function idOf(sql: string, params: unknown[]): Promise<string> {
  const r = await query<{ id: string }>(sql, params);
  const row = r.rows[0];
  if (!row) throw new Error(`시드 실패: id 미반환 — ${sql}`);
  return row.id;
}

function devPasswordHash(password: string): string {
  const salt = "smarthome-dev-admin";
  const iterations = 120000;
  const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("base64url");
  return `pbkdf2$sha256$${iterations}$${salt}$${hash}`;
}

async function seed(): Promise<void> {
  // ─── 공간 계층 ──────────────────────────────────────────────────
  const entId = await idOf(
    `INSERT INTO enterprise (slug, name) VALUES ('acme', 'Acme')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [],
  );
  const siteId = await idOf(
    `INSERT INTO site (enterprise_id, slug, name) VALUES ($1, 'site1', 'Site 1')
     ON CONFLICT (enterprise_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [entId],
  );
  const bldgId = await idOf(
    `INSERT INTO building (site_id, slug, name) VALUES ($1, 'bldg-a', 'Building A')
     ON CONFLICT (site_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [siteId],
  );

  const floorId = await idOf(
    `INSERT INTO floor (building_id, slug, name) VALUES ($1, '2f', '2F')
     ON CONFLICT (building_id, slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [bldgId],
  );

  // 배경 이미지(placeholder — 800x600) — area가 직접 가진다.
  const imageId = await idOf(
    `INSERT INTO image (name, image_url, width_px, height_px)
     VALUES ('2F 배경', 'https://placehold.co/800x600', 800, 600)
     ON CONFLICT (image_url) DO UPDATE SET
       width_px = EXCLUDED.width_px,
       height_px = EXCLUDED.height_px
     RETURNING id`,
    [],
  );

  // ─── 지역 기본 area 1개 ─────────────────────────────────────────
  const defaultAreaId = await idOf(
    `INSERT INTO area (floor_id, slug, name, polygon, image_id)
     VALUES ($1, 'default', '2F', '[]'::jsonb, $2)
     ON CONFLICT (floor_id, slug) DO UPDATE SET name = EXCLUDED.name, image_id = EXCLUDED.image_id
     RETURNING id`,
    [floorId, imageId],
  );
  const livingRoomId = defaultAreaId;
  const bedroomId = defaultAreaId;

  // ─── Device 3대 ────────────────────────────────────────────────
  // 1) thermostat-01 (거실, 시뮬레이터와 정합)
  const t01Topic = buildDeviceBase({
    site: "site1",
    building: "bldg-a",
    floor: "2f",
    area: "default",
    device: "thermostat-01",
  });
  await query(
    `INSERT INTO device (
       code, name, category, device_role, device_type, mqtt_topic, area_id, current_status,
       sensor_signal_type, sensor_io_type, channel_address, pos_x, pos_y
     )
     VALUES ('thermostat-01', '거실 온도조절기', 'SENSOR', 'SENSOR', 'thermostat', $1, $2, 'OFFLINE',
       'ANALOG', 'AI', '01', 200, 200)
     ON CONFLICT (code) DO UPDATE SET
       mqtt_topic = EXCLUDED.mqtt_topic,
       area_id = EXCLUDED.area_id,
       sensor_signal_type = EXCLUDED.sensor_signal_type,
       sensor_io_type = EXCLUDED.sensor_io_type,
       channel_address = EXCLUDED.channel_address,
       pos_x = EXCLUDED.pos_x,
       pos_y = EXCLUDED.pos_y`,
    [t01Topic, livingRoomId],
  );

  // 2) light-01 (거실, 대시보드 ON/OFF 테스트용)
  const l01Topic = buildDeviceBase({
    site: "site1",
    building: "bldg-a",
    floor: "2f",
    area: "default",
    device: "light-01",
  });
  await query(
    `INSERT INTO device (
       code, name, category, device_role, device_type, mqtt_topic, area_id, current_status,
       sensor_signal_type, sensor_io_type, channel_address, pos_x, pos_y
     )
     VALUES ('light-01', '거실 조명', 'DEVICE', 'SENSOR', 'light', $1, $2, 'OFF',
       'DIGITAL', 'DO', '02', 350, 250)
     ON CONFLICT (code) DO UPDATE SET
       mqtt_topic = EXCLUDED.mqtt_topic,
       area_id = EXCLUDED.area_id,
       sensor_signal_type = EXCLUDED.sensor_signal_type,
       sensor_io_type = EXCLUDED.sensor_io_type,
       channel_address = EXCLUDED.channel_address,
       pos_x = EXCLUDED.pos_x,
       pos_y = EXCLUDED.pos_y`,
    [l01Topic, livingRoomId],
  );

  // 3) light-02 (침실)
  const l02Topic = buildDeviceBase({
    site: "site1",
    building: "bldg-a",
    floor: "2f",
    area: "default",
    device: "light-02",
  });
  await query(
    `INSERT INTO device (
       code, name, category, device_role, device_type, mqtt_topic, area_id, current_status,
       sensor_signal_type, sensor_io_type, channel_address, pos_x, pos_y
     )
     VALUES ('light-02', '침실 조명', 'DEVICE', 'SENSOR', 'light', $1, $2, 'OFF',
       'DIGITAL', 'DO', '03', 620, 250)
     ON CONFLICT (code) DO UPDATE SET
       mqtt_topic = EXCLUDED.mqtt_topic,
       area_id = EXCLUDED.area_id,
       sensor_signal_type = EXCLUDED.sensor_signal_type,
       sensor_io_type = EXCLUDED.sensor_io_type,
       channel_address = EXCLUDED.channel_address,
       pos_x = EXCLUDED.pos_x,
       pos_y = EXCLUDED.pos_y`,
    [l02Topic, bedroomId],
  );

  // ─── Admin 사용자 ──────────────────────────────────────────────
  const adminId = await idOf(
    `INSERT INTO app_user (username, email, password_hash, display_name)
     VALUES ('admin', 'admin@smarthome.local', $1, 'Dev Admin')
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, display_name = EXCLUDED.display_name
     RETURNING id`,
    [devPasswordHash("admin1234")],
  );
  await query(
    `INSERT INTO user_role (user_id, role)
     VALUES ($1, 'ADMIN')
     ON CONFLICT (user_id, role) DO NOTHING`,
    [adminId],
  );

  console.log(
    `[seed] 완료 — floor=${floorId}, area=default, devices=3, admin=admin`,
  );
}

seed()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("[seed] 오류:", err);
    process.exit(1);
  });
