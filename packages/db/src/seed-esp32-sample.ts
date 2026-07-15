import { buildDeviceBase } from "@smarthome/contracts";
import { closePool, query } from "./pool.js";

/**
 * ESP32 릴레이 보드 조명 제어 샘플 — 5층 건물, 층당 보드 2대, 보드당 디지털아웃 10채널.
 * 보드(ESP32) = device_role 'MONITORING_EQUIPMENT'(감시장비, category='GATEWAY').
 * 채널(전등)  = device_role 'SENSOR' + parent_device_id(보드 id), sensor_io_type='DO'.
 *
 * 보드와 그 보드가 제어하는 전등은 같은 지역(area)에 배정한다(2026-07-15 합의). 관제 화면은
 * "감시장비" 모드에서 선택된 지역 소속 감시장비만 보여주므로, 보드를 별도 분전반(PANEL) area에
 * 두면 그 보드가 켜는 전등이 있는 지역에서는 감시장비가 항상 0개로 보이는 문제가 있었다 — 예전엔
 * 분전반(Area.kind='PANEL')과 방(kind='ROOM')을 분리했지만, 그 구조를 이 샘플에서는 걷어냈다.
 */

type DeviceStatus = "ON" | "OFF" | "WARNING" | "ALARM" | "OFFLINE";

interface RoomAreaDef {
  slug: "office" | "corridor" | "toilet" | "stairs";
  name: string;
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
  { slug: "office", name: "사무실", baseX: 280, baseY: 195 },
  { slug: "corridor", name: "복도", baseX: 640, baseY: 195 },
  { slug: "toilet", name: "화장실", baseX: 160, baseY: 430 },
  { slug: "stairs", name: "계단", baseX: 395, baseY: 430 },
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
    const floorId = await idOf(
      `INSERT INTO floor (building_id, slug, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (building_id, slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id::text AS id`,
      [buildingId, floor.slug, floor.name],
    );

    // 배경 이미지 — 지역(area)이 직접 가진다(2026-07-15 합의, floor_map 대신 image 라이브러리).
    const imageId = await idOf(
      `INSERT INTO image (name, image_url, width_px, height_px)
       VALUES ($1, $2, 820, 580)
       ON CONFLICT (image_url) DO UPDATE SET width_px = EXCLUDED.width_px, height_px = EXCLUDED.height_px
       RETURNING id::text AS id`,
      [`${floor.name} 배경`, `https://placehold.co/820x580?text=${encodeURIComponent(floor.name)}`],
    );

    // 지역(=floor)당 기본 ROOM area 1개 — 전등과 그 전등을 켜는 감시장비(보드)가 모두 이 area에
    // 배정된다(device.area_id, 2026-07-15 합의). 사무실/복도/화장실/계단 구분은 area row가 아니라
    // 배치 좌표로만 표현한다.
    const defaultRoomAreaId = await idOf(
      `INSERT INTO area (floor_id, slug, name, polygon, kind, image_id)
       VALUES ($1, 'default', $2, '[]'::jsonb, 'ROOM', $3)
       ON CONFLICT (floor_id, slug) DO UPDATE SET name = EXCLUDED.name, image_id = EXCLUDED.image_id
       RETURNING id::text AS id`,
      [floorId, floor.name, imageId],
    );

    // 예전에 보드를 담아두던 분전반(PANEL) area 잔재 정리 — 이제 보드는 defaultRoomAreaId에 있다.
    await query(`DELETE FROM area WHERE floor_id::text = $1 AND slug IN ('panel-a', 'panel-b')`, [floorId]);

    const floorLightGroupId = await upsertGroup(`esp32-${floor.slug}-lights`, `${floor.name} 전등`);

    for (const [boardIdx, boardSlug] of BOARD_SLUGS.entries()) {
      const boardCode = `${floor.slug}-esp32-${boardSlug}`;
      const boardTopic = buildDeviceBase({
        site: "main-site",
        building: "esp32-building",
        floor: floor.slug,
        area: "default",
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
          defaultRoomAreaId,
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
        const areaId = defaultRoomAreaId;
        const channelStr = String(ch).padStart(2, "0");
        const lightCode = `${boardCode}-light-${channelStr}`;
        const lightTopic = buildDeviceBase({
          site: "main-site",
          building: "esp32-building",
          floor: floor.slug,
          area: "default",
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
