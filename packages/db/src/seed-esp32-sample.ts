import { buildDeviceBase } from "@smarthome/contracts";
import { closePool, query } from "./pool.js";

/**
 * ESP32 릴레이 보드 조명 제어 샘플 — 5층 건물, 층당 보드 2대, 보드당 디지털아웃 10채널.
 * 보드(ESP32) = device_role 'MONITORING_EQUIPMENT'(감시장비, category='GATEWAY').
 * 채널(전등)  = device_role 'SENSOR' + parent_device_id(보드 id), sensor_io_type='DO'.
 *
 * 보드 하나가 물리적으로는 하나의 MQTT 연결만 유지하지만(LWT는 보드 단위), 그 10개 채널이
 * 여러 방(Area)의 전등을 섞어서 담당하는 배선을 가정한다. 그래서 보드 자신은 실제 방과
 * 무관한 분전반(Area.kind='PANEL')에 두고, 각 전등은 실제로 불을 켜는 방(kind='ROOM')에
 * 둔다 — docs/srs-lighting-control-addendum.md §2, 마이그레이션 0016 참고.
 */

type DeviceStatus = "ON" | "OFF" | "WARNING" | "ALARM" | "OFFLINE";

interface RoomAreaDef {
  slug: "office" | "corridor" | "toilet" | "stairs";
  name: string;
  polygon: number[][];
  baseX: number;
  baseY: number;
}

const FLOORS = Array.from({ length: 5 }, (_, i) => {
  const n = i + 1;
  return { slug: `${n}f`, name: `${n}F`, sort: n };
});

const BOARD_SLUGS = ["a", "b"] as const;
const CHANNELS_PER_BOARD = 10;

// 보드 채널은 이 4개 방을 순환 배정받는다(채널 1→office, 2→corridor, 3→toilet, 4→stairs, 5→office ...).
const ROOM_AREAS: RoomAreaDef[] = [
  { slug: "office", name: "사무실", polygon: [[60, 70], [500, 70], [500, 320], [60, 320]], baseX: 280, baseY: 195 },
  { slug: "corridor", name: "복도", polygon: [[520, 70], [760, 70], [760, 320], [520, 320]], baseX: 640, baseY: 195 },
  { slug: "toilet", name: "화장실", polygon: [[60, 340], [260, 340], [260, 520], [60, 520]], baseX: 160, baseY: 430 },
  { slug: "stairs", name: "계단", polygon: [[290, 340], [500, 340], [500, 520], [290, 520]], baseX: 395, baseY: 430 },
];

async function idOf(sql: string, params: unknown[]): Promise<string> {
  const r = await query<{ id: string }>(sql, params);
  const row = r.rows[0];
  if (!row) throw new Error(`esp32 sample seed failed: id not returned — ${sql}`);
  return row.id;
}

async function upsertGroup(slug: string, name: string): Promise<string> {
  return idOf(
    `INSERT INTO device_group (slug, name, is_dynamic)
     VALUES ($1, $2, false)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id::text AS id`,
    [slug, name],
  );
}

async function mapDeviceToGroup(deviceId: string, groupId: string): Promise<void> {
  await query(
    `INSERT INTO device_group_mapping (device_id, group_id)
     VALUES ($1, $2)
     ON CONFLICT (device_id, group_id) DO NOTHING`,
    [deviceId, groupId],
  );
}

/** 채널 번호(1-base) → 담당 방. 4개 방을 순환하며 배정해 "보드 1대가 여러 지역을 섞어서 담당"을 구현한다. */
function roomForChannel(channelIndex: number): RoomAreaDef {
  return ROOM_AREAS[(channelIndex - 1) % ROOM_AREAS.length]!;
}

function statusForChannel(floorSort: number, boardIdx: number, channel: number): DeviceStatus {
  return (floorSort + boardIdx + channel) % 3 === 0 ? "ON" : "OFF";
}

async function seedEsp32Sample(): Promise<void> {
  const entId = await idOf(
    `INSERT INTO enterprise (slug, name) VALUES ('esp32-demo', 'ESP32 조명 제어 시범동')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id::text AS id`,
    [],
  );
  const siteId = await idOf(
    `INSERT INTO site (enterprise_id, slug, name) VALUES ($1, 'main-site', '본사')
     ON CONFLICT (enterprise_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id::text AS id`,
    [entId],
  );
  const buildingId = await idOf(
    `INSERT INTO building (site_id, slug, name) VALUES ($1, 'esp32-building', '지상 5층 시범동')
     ON CONFLICT (site_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id::text AS id`,
    [siteId],
  );

  const allLightGroupId = await upsertGroup("esp32-all-lights", "전체 전등");

  let deviceCount = 0;
  let boardCount = 0;

  for (const floor of FLOORS) {
    const floorMapId = await idOf(
      `INSERT INTO floor_map (image_url, width_px, height_px, scale_m_per_px)
       VALUES ($1, 820, 580, 0.05)
       ON CONFLICT (image_url) DO UPDATE SET
         width_px = EXCLUDED.width_px,
         height_px = EXCLUDED.height_px,
         scale_m_per_px = EXCLUDED.scale_m_per_px
       RETURNING id::text AS id`,
      [`https://placehold.co/820x580?text=${encodeURIComponent(floor.name)}`],
    );
    const floorId = await idOf(
      `INSERT INTO floor (building_id, slug, name, floor_map_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (building_id, slug) DO UPDATE SET
         name = EXCLUDED.name,
         floor_map_id = EXCLUDED.floor_map_id
       RETURNING id::text AS id`,
      [buildingId, floor.slug, floor.name, floorMapId],
    );

    // 방(ROOM) Area 4곳 — 실제로 전등이 켜지는 위치. 보드와 무관하게 층마다 한 번만 만든다.
    const roomAreaIds = new Map<string, string>();
    for (const room of ROOM_AREAS) {
      const areaId = await idOf(
        `INSERT INTO area (floor_id, slug, name, polygon, kind)
         VALUES ($1, $2, $3, $4, 'ROOM')
         ON CONFLICT (floor_id, slug) DO UPDATE SET
           name = EXCLUDED.name,
           polygon = EXCLUDED.polygon,
           kind = EXCLUDED.kind
         RETURNING id::text AS id`,
        [floorId, room.slug, room.name, JSON.stringify(room.polygon)],
      );
      roomAreaIds.set(room.slug, areaId);
    }

    const floorLightGroupId = await upsertGroup(`esp32-${floor.slug}-lights`, `${floor.name} 전등`);

    for (const [boardIdx, boardSlug] of BOARD_SLUGS.entries()) {
      // 분전반(PANEL) Area — 보드가 물리적으로 위치한 곳(전등이 실제로 켜지는 방과는 별개).
      const panelSlug = `panel-${boardSlug}`;
      const panelAreaId = await idOf(
        `INSERT INTO area (floor_id, slug, name, polygon, kind, pos_x, pos_y)
         VALUES ($1, $2, $3, '[]'::jsonb, 'PANEL', $4, $5)
         ON CONFLICT (floor_id, slug) DO UPDATE SET
           name = EXCLUDED.name,
           pos_x = EXCLUDED.pos_x,
           pos_y = EXCLUDED.pos_y
         RETURNING id::text AS id`,
        [floorId, panelSlug, `${floor.name} 분전반 ${boardSlug.toUpperCase()}`, 780, 40 + boardIdx * 40],
      );

      const boardCode = `${floor.slug}-esp32-${boardSlug}`;
      const boardTopic = buildDeviceBase({
        site: "main-site",
        building: "esp32-building",
        floor: floor.slug,
        area: panelSlug,
        device: boardCode,
      });
      // 같은 네트워크(서브넷)에서 보드마다 고유 IP를 부여받는다고 가정.
      const boardHost = `192.168.50.${floor.sort * 10 + boardIdx + 1}`;
      const boardId = await idOf(
        `INSERT INTO device (
           code, name, category, device_role, device_type, manufacturer, model, firmware_version,
           mqtt_topic, area_id, current_status, lifecycle_status, pos_x, pos_y,
           connection_protocol, connection_config, monitoring_visible, enabled
         )
         VALUES ($1,$2,'GATEWAY','MONITORING_EQUIPMENT','esp32_relay_board','Espressif','ESP32-DevKitC','1.0.0',
           $3,$4,'ON','ACTIVE',$5,$6,'TCP_IP',$7,true,true)
         ON CONFLICT (code) DO UPDATE SET
           name = EXCLUDED.name,
           category = EXCLUDED.category,
           device_role = EXCLUDED.device_role,
           device_type = EXCLUDED.device_type,
           manufacturer = EXCLUDED.manufacturer,
           model = EXCLUDED.model,
           firmware_version = EXCLUDED.firmware_version,
           mqtt_topic = EXCLUDED.mqtt_topic,
           area_id = EXCLUDED.area_id,
           lifecycle_status = EXCLUDED.lifecycle_status,
           pos_x = EXCLUDED.pos_x,
           pos_y = EXCLUDED.pos_y,
           connection_protocol = EXCLUDED.connection_protocol,
           connection_config = EXCLUDED.connection_config,
           monitoring_visible = true,
           enabled = true
         RETURNING id::text AS id`,
        [
          boardCode,
          `${floor.name} ESP32 릴레이 보드 ${boardSlug.toUpperCase()}`,
          boardTopic,
          panelAreaId,
          780,
          40 + boardIdx * 40,
          JSON.stringify({ host: boardHost, port: 1883 }),
        ],
      );
      deviceCount += 1;
      boardCount += 1;

      const boardLightGroupId = await upsertGroup(
        `esp32-${floor.slug}-${boardSlug}-lights`,
        `${floor.name} 보드${boardSlug.toUpperCase()} 전등`,
      );

      for (let ch = 1; ch <= CHANNELS_PER_BOARD; ch++) {
        const room = roomForChannel(ch);
        const areaId = roomAreaIds.get(room.slug)!;
        const channelStr = String(ch).padStart(2, "0");
        const lightCode = `${boardCode}-light-${channelStr}`;
        const lightTopic = buildDeviceBase({
          site: "main-site",
          building: "esp32-building",
          floor: floor.slug,
          area: room.slug,
          device: lightCode,
        });
        // 보드당 마지막 채널만 비상등(EMERGENCY), 나머지는 일반등(NORMAL) — 실제 배선 관례를 흉내.
        const loadClass = ch === CHANNELS_PER_BOARD ? "EMERGENCY" : "NORMAL";
        // 같은 방을 여러 채널이 나눠 맡을 수 있어(4개 방을 최대 3바퀴 순환) 좌표를 조금씩 어긋나게 배치.
        const roomOccurrence = Math.floor((ch - 1) / ROOM_AREAS.length);
        const posX = room.baseX + (roomOccurrence - 1) * 26;
        const posY = room.baseY + (boardIdx === 0 ? -14 : 14);

        const lightId = await idOf(
          `INSERT INTO device (
             code, name, category, device_role, device_type, manufacturer, model, firmware_version,
             mqtt_topic, area_id, parent_device_id, current_status, lifecycle_status,
             sensor_signal_type, sensor_io_type, channel_address, terminal_block, load_class,
             pos_x, pos_y, monitoring_visible, enabled
           )
           VALUES ($1,$2,'DEVICE','SENSOR','light','Espressif','ESP32-DevKitC','1.0.0',$3,$4,$5,$6,'ACTIVE',
             'DIGITAL','DO',$7,$8,$9::load_class,$10,$11,true,true)
           ON CONFLICT (code) DO UPDATE SET
             name = EXCLUDED.name,
             category = EXCLUDED.category,
             device_role = EXCLUDED.device_role,
             device_type = EXCLUDED.device_type,
             manufacturer = EXCLUDED.manufacturer,
             model = EXCLUDED.model,
             firmware_version = EXCLUDED.firmware_version,
             mqtt_topic = EXCLUDED.mqtt_topic,
             area_id = EXCLUDED.area_id,
             parent_device_id = EXCLUDED.parent_device_id,
             current_status = EXCLUDED.current_status,
             lifecycle_status = EXCLUDED.lifecycle_status,
             sensor_signal_type = EXCLUDED.sensor_signal_type,
             sensor_io_type = EXCLUDED.sensor_io_type,
             channel_address = EXCLUDED.channel_address,
             terminal_block = EXCLUDED.terminal_block,
             load_class = EXCLUDED.load_class,
             pos_x = EXCLUDED.pos_x,
             pos_y = EXCLUDED.pos_y,
             monitoring_visible = true,
             enabled = true
           RETURNING id::text AS id`,
          [
            lightCode,
            `${floor.name} ${room.name} 전등(${boardSlug.toUpperCase()}-CH${channelStr})`,
            lightTopic,
            areaId,
            boardId,
            statusForChannel(floor.sort, boardIdx, ch),
            channelStr,
            boardCode,
            loadClass,
            posX,
            posY,
          ],
        );
        deviceCount += 1;

        await mapDeviceToGroup(lightId, allLightGroupId);
        await mapDeviceToGroup(lightId, floorLightGroupId);
        await mapDeviceToGroup(lightId, boardLightGroupId);
      }
    }
  }

  console.log(
    `[seed:esp32-sample] 완료 — floors=${FLOORS.length}, boards=${boardCount}, devices=${deviceCount}`,
  );
}

seedEsp32Sample()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("[seed:esp32-sample] 오류:", err);
    process.exit(1);
  });
