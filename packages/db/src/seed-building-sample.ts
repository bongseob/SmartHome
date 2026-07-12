import { buildDeviceBase } from "@smarthome/contracts";
import { closePool, query } from "./pool.js";

type DeviceStatus = "ON" | "OFF" | "WARNING" | "ALARM" | "OFFLINE";
type DeviceKind = "light" | "aircon" | "fire_detector";

interface FloorDef {
  slug: string;
  name: string;
  sort: number;
}

interface AreaDef {
  slug: "toilet" | "corridor" | "stairs" | "office";
  name: string;
  polygon: number[][];
  baseX: number;
  baseY: number;
}

interface DeviceDef {
  kind: DeviceKind;
  index: number;
  category: "DEVICE" | "SENSOR";
  deviceType: string;
  sensorIoType: "DI" | "DO" | "AI" | "AO";
  namePrefix: string;
  posDx: number;
  posDy: number;
  /** 부하 구분 — 조명(전등) 차단기만 비상등(EMERGENCY)/일반등(NORMAL)으로 나뉜다.
   *  전열/기타(에어컨·화재감지기)는 조명의 비상/일반 축과 무관하므로 미지정(null). */
  loadClass?: "NORMAL" | "EMERGENCY" | "RESERVE";
}

const FLOORS: FloorDef[] = [
  { slug: "b3", name: "B3F", sort: -3 },
  { slug: "b2", name: "B2F", sort: -2 },
  { slug: "b1", name: "B1F", sort: -1 },
  ...Array.from({ length: 16 }, (_, i) => {
    const n = i + 1;
    return { slug: `${n}f`, name: `${n}F`, sort: n };
  }),
];

const AREAS: AreaDef[] = [
  {
    slug: "toilet",
    name: "화장실",
    polygon: [[60, 70], [260, 70], [260, 230], [60, 230]],
    baseX: 120,
    baseY: 130,
  },
  {
    slug: "corridor",
    name: "복도",
    polygon: [[290, 70], [760, 70], [760, 230], [290, 230]],
    baseX: 360,
    baseY: 130,
  },
  {
    slug: "stairs",
    name: "계단",
    polygon: [[60, 270], [260, 270], [260, 520], [60, 520]],
    baseX: 120,
    baseY: 340,
  },
  {
    slug: "office",
    name: "사무실",
    polygon: [[290, 270], [760, 270], [760, 520], [290, 520]],
    baseX: 360,
    baseY: 340,
  },
];

const DEVICES: DeviceDef[] = [
  // 전등(조명) — 전등1 = 일반등(NORMAL), 전등2 = 비상등(EMERGENCY).
  { kind: "light", index: 1, category: "DEVICE", deviceType: "light", sensorIoType: "DO", namePrefix: "일반등", posDx: 0, posDy: 0, loadClass: "NORMAL" },
  { kind: "light", index: 2, category: "DEVICE", deviceType: "light", sensorIoType: "DO", namePrefix: "비상등", posDx: 58, posDy: 0, loadClass: "EMERGENCY" },
  // 전열/기타 — 조명의 비상/일반 축과 무관(load_class 미지정).
  { kind: "aircon", index: 1, category: "DEVICE", deviceType: "aircon", sensorIoType: "DO", namePrefix: "에어컨", posDx: 0, posDy: 58 },
  { kind: "fire_detector", index: 1, category: "SENSOR", deviceType: "fire_detector", sensorIoType: "DI", namePrefix: "화재감지기", posDx: 58, posDy: 58 },
];

async function idOf(sql: string, params: unknown[]): Promise<string> {
  const r = await query<{ id: string }>(sql, params);
  const row = r.rows[0];
  if (!row) throw new Error(`sample seed failed: id not returned — ${sql}`);
  return row.id;
}

function statusFor(floorSort: number, areaIndex: number, device: DeviceDef): DeviceStatus {
  if (device.kind === "fire_detector" && floorSort === 7 && areaIndex === 3) return "ALARM";
  if (device.kind === "fire_detector" && floorSort % 6 === 0 && areaIndex === 1) return "WARNING";
  if (device.kind === "aircon" && floorSort % 5 === 0 && areaIndex === 2) return "OFFLINE";
  if (device.kind === "light") return (floorSort + areaIndex + device.index) % 3 === 0 ? "ON" : "OFF";
  if (device.kind === "aircon") return floorSort >= 1 && floorSort <= 16 && areaIndex === 3 ? "ON" : "OFF";
  return "ON";
}

function codeKind(kind: DeviceKind): string {
  return kind === "fire_detector" ? "fire-detector" : kind;
}

function signalTypeForIo(ioType: DeviceDef["sensorIoType"]): "DIGITAL" | "ANALOG" {
  return ioType.startsWith("D") ? "DIGITAL" : "ANALOG";
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

async function seedBuildingSample(): Promise<void> {
  const entId = await idOf(
    `INSERT INTO enterprise (slug, name) VALUES ('sample-bank', '샘플 업무시설')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id::text AS id`,
    [],
  );
  const siteId = await idOf(
    `INSERT INTO site (enterprise_id, slug, name) VALUES ($1, 'main-site', '본점')
     ON CONFLICT (enterprise_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id::text AS id`,
    [entId],
  );
  const buildingId = await idOf(
    `INSERT INTO building (site_id, slug, name) VALUES ($1, 'main-building', '지하3층 지상16층 샘플빌딩')
     ON CONFLICT (site_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id::text AS id`,
    [siteId],
  );

  const allGroupId = await upsertGroup("sample-all", "전체");
  const allLightGroupId = await upsertGroup("sample-all-lights", "전체 전등");
  const allAirconGroupId = await upsertGroup("sample-all-aircon", "전체 에어컨");
  const allFireGroupId = await upsertGroup("sample-all-fire-detectors", "전체 화재감지기");
  const areaGroupIds = new Map<string, string>();
  for (const area of AREAS) {
    areaGroupIds.set(area.slug, await upsertGroup(`sample-all-${area.slug}`, `전체 ${area.name}`));
  }

  let deviceCount = 0;
  let areaCount = 0;

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

    const floorGroupId = await upsertGroup(`sample-${floor.slug}-all`, `${floor.name} 전체`);
    const floorLightGroupId = await upsertGroup(`sample-${floor.slug}-lights`, `${floor.name} 전등`);
    const floorAirconGroupId = await upsertGroup(`sample-${floor.slug}-aircon`, `${floor.name} 에어컨`);
    const floorFireGroupId = await upsertGroup(`sample-${floor.slug}-fire-detectors`, `${floor.name} 화재감지기`);

    for (const [areaIndex, area] of AREAS.entries()) {
      const areaId = await idOf(
        `INSERT INTO area (floor_id, slug, name, polygon, kind)
         VALUES ($1, $2, $3, $4, 'ROOM')
         ON CONFLICT (floor_id, slug) DO UPDATE SET
           name = EXCLUDED.name,
           polygon = EXCLUDED.polygon,
           kind = EXCLUDED.kind
         RETURNING id::text AS id`,
        [floorId, area.slug, area.name, JSON.stringify(area.polygon)],
      );
      areaCount += 1;

      const floorAreaGroupId = await upsertGroup(`sample-${floor.slug}-${area.slug}`, `${floor.name} ${area.name}`);
      const rmuCode = `${floor.slug}-${area.slug}-rmu`;
      const rmuTopic = buildDeviceBase({
        site: "main-site",
        building: "main-building",
        floor: floor.slug,
        area: area.slug,
        device: rmuCode,
      });
      const rmuId = await idOf(
        `INSERT INTO device (
           code, name, category, device_role, device_type, manufacturer, model, firmware_version,
           mqtt_topic, area_id, current_status, lifecycle_status, pos_x, pos_y,
           connection_protocol, connection_config, terminal_block, monitoring_visible, enabled
         )
         VALUES ($1,$2,'GATEWAY','MONITORING_EQUIPMENT','rmu','SampleCo','RMU-200','1.0.0',
           $3,$4,'ON','ACTIVE',$5,$6,'TCP_IP',$7,$8,true,true)
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
           current_status = EXCLUDED.current_status,
           lifecycle_status = EXCLUDED.lifecycle_status,
           pos_x = EXCLUDED.pos_x,
           pos_y = EXCLUDED.pos_y,
           connection_protocol = EXCLUDED.connection_protocol,
           connection_config = EXCLUDED.connection_config,
           terminal_block = EXCLUDED.terminal_block,
           monitoring_visible = true,
           enabled = true
         RETURNING id::text AS id`,
        [
          rmuCode,
          `${floor.name} ${area.name} RMU`,
          rmuTopic,
          areaId,
          area.baseX + 116,
          area.baseY - 38,
          JSON.stringify({ host: `192.168.${100 + Math.max(floor.sort, 0)}.${10 + areaIndex}`, port: 20000 }),
          `${floor.name}-${area.name}`,
        ],
      );
      deviceCount += 1;
      await mapDeviceToGroup(rmuId, allGroupId);
      await mapDeviceToGroup(rmuId, floorGroupId);
      await mapDeviceToGroup(rmuId, floorAreaGroupId);

      for (const device of DEVICES) {
        const code = `${floor.slug}-${area.slug}-${codeKind(device.kind)}-${String(device.index).padStart(2, "0")}`;
        const topic = buildDeviceBase({
          site: "main-site",
          building: "main-building",
          floor: floor.slug,
          area: area.slug,
          device: code,
        });
        const deviceId = await idOf(
          `INSERT INTO device (
             code, name, category, device_role, device_type, manufacturer, model, firmware_version,
             mqtt_topic, area_id, parent_device_id, current_status, lifecycle_status,
             sensor_signal_type, sensor_io_type, channel_address, terminal_block, load_class,
             pos_x, pos_y, monitoring_visible, enabled
           )
           VALUES ($1,$2,$3,'SENSOR',$4,'SampleCo','SIM-100','1.0.0',$5,$6,$7,$8,'ACTIVE',
             $9,$10,$11,$12,$15::load_class,$13,$14,true,true)
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
            code,
            `${floor.name} ${area.name} ${device.namePrefix}${device.kind === "light" ? "" : ` ${device.index}`}`,
            device.category,
            device.deviceType,
            topic,
            areaId,
            rmuId,
            statusFor(floor.sort, areaIndex, device),
            signalTypeForIo(device.sensorIoType),
            device.sensorIoType,
            String(6 + device.index + areaIndex * DEVICES.length).padStart(2, "0"),
            `${floor.name}-${area.name}`,
            area.baseX + device.posDx,
            area.baseY + device.posDy,
            device.loadClass ?? null,
          ],
        );
        deviceCount += 1;

        await mapDeviceToGroup(deviceId, allGroupId);
        await mapDeviceToGroup(deviceId, floorGroupId);
        await mapDeviceToGroup(deviceId, floorAreaGroupId);
        const allAreaGroupId = areaGroupIds.get(area.slug);
        if (allAreaGroupId) await mapDeviceToGroup(deviceId, allAreaGroupId);
        if (device.kind === "light") {
          await mapDeviceToGroup(deviceId, allLightGroupId);
          await mapDeviceToGroup(deviceId, floorLightGroupId);
        } else if (device.kind === "aircon") {
          await mapDeviceToGroup(deviceId, allAirconGroupId);
          await mapDeviceToGroup(deviceId, floorAirconGroupId);
        } else {
          await mapDeviceToGroup(deviceId, allFireGroupId);
          await mapDeviceToGroup(deviceId, floorFireGroupId);
        }
      }
    }
  }

  console.log(`[seed:building-sample] 완료 — floors=${FLOORS.length}, areas=${areaCount}, devices=${deviceCount}`);
}

seedBuildingSample()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("[seed:building-sample] 오류:", err);
    process.exit(1);
  });
