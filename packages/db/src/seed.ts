import { buildDeviceBase } from "@smarthome/contracts";
import { pbkdf2Sync } from "node:crypto";
import { closePool, query } from "./pool.js";

/**
 * 개발용 시드 (idempotent). 대시보드 검증용으로 Area 2개, 기기 3대, floor_map 포함.
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

  // floor_map (placeholder — 800x600)
  const mapId = await idOf(
    `INSERT INTO floor_map (image_url, width_px, height_px, scale_m_per_px)
     VALUES ('https://placehold.co/800x600', 800, 600, 0.05)
     ON CONFLICT (image_url) DO UPDATE SET
       width_px = EXCLUDED.width_px,
       height_px = EXCLUDED.height_px,
       scale_m_per_px = EXCLUDED.scale_m_per_px
     RETURNING id`,
    [],
  );

  const floorId = await idOf(
    `INSERT INTO floor (building_id, slug, name, floor_map_id) VALUES ($1, '2f', '2F', $2)
     ON CONFLICT (building_id, slug)
     DO UPDATE SET name = EXCLUDED.name, floor_map_id = EXCLUDED.floor_map_id
     RETURNING id`,
    [bldgId, mapId],
  );

  // ─── Area 2개 (polygon 포함) ────────────────────────────────────
  const livingRoomId = await idOf(
    `INSERT INTO area (floor_id, slug, name, polygon)
     VALUES ($1, 'living-room', '거실', $2)
     ON CONFLICT (floor_id, slug) DO UPDATE SET name = EXCLUDED.name, polygon = EXCLUDED.polygon
     RETURNING id`,
    [
      floorId,
      JSON.stringify([
        [100, 100],
        [500, 100],
        [500, 400],
        [100, 400],
      ]),
    ],
  );

  const bedroomId = await idOf(
    `INSERT INTO area (floor_id, slug, name, polygon)
     VALUES ($1, 'bedroom', '침실', $2)
     ON CONFLICT (floor_id, slug) DO UPDATE SET name = EXCLUDED.name, polygon = EXCLUDED.polygon
     RETURNING id`,
    [
      floorId,
      JSON.stringify([
        [520, 100],
        [750, 100],
        [750, 400],
        [520, 400],
      ]),
    ],
  );

  // ─── Device 3대 ────────────────────────────────────────────────
  // 1) thermostat-01 (거실, 시뮬레이터와 정합)
  const t01Topic = buildDeviceBase({
    site: "site1",
    building: "bldg-a",
    floor: "2f",
    area: "living-room",
    device: "thermostat-01",
  });
  await query(
    `INSERT INTO device (code, name, category, device_type, mqtt_topic, area_id, current_status, pos_x, pos_y)
     VALUES ('thermostat-01', '거실 온도조절기', 'SENSOR', 'thermostat', $1, $2, 'OFFLINE', 200, 200)
     ON CONFLICT (code) DO UPDATE SET
       mqtt_topic = EXCLUDED.mqtt_topic,
       area_id = EXCLUDED.area_id,
       pos_x = EXCLUDED.pos_x,
       pos_y = EXCLUDED.pos_y`,
    [t01Topic, livingRoomId],
  );

  // 2) light-01 (거실, 대시보드 ON/OFF 테스트용)
  const l01Topic = buildDeviceBase({
    site: "site1",
    building: "bldg-a",
    floor: "2f",
    area: "living-room",
    device: "light-01",
  });
  await query(
    `INSERT INTO device (code, name, category, device_type, mqtt_topic, area_id, current_status, pos_x, pos_y)
     VALUES ('light-01', '거실 조명', 'DEVICE', 'light', $1, $2, 'OFF', 350, 250)
     ON CONFLICT (code) DO UPDATE SET
       mqtt_topic = EXCLUDED.mqtt_topic,
       area_id = EXCLUDED.area_id,
       pos_x = EXCLUDED.pos_x,
       pos_y = EXCLUDED.pos_y`,
    [l01Topic, livingRoomId],
  );

  // 3) light-02 (침실)
  const l02Topic = buildDeviceBase({
    site: "site1",
    building: "bldg-a",
    floor: "2f",
    area: "bedroom",
    device: "light-02",
  });
  await query(
    `INSERT INTO device (code, name, category, device_type, mqtt_topic, area_id, current_status, pos_x, pos_y)
     VALUES ('light-02', '침실 조명', 'DEVICE', 'light', $1, $2, 'OFF', 620, 250)
     ON CONFLICT (code) DO UPDATE SET
       mqtt_topic = EXCLUDED.mqtt_topic,
       area_id = EXCLUDED.area_id,
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
    `[seed] 완료 — floor=${floorId}, areas=[living-room, bedroom], devices=3, admin=admin`,
  );
}

seed()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("[seed] 오류:", err);
    process.exit(1);
  });
