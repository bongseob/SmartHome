import { UNS_ROOT } from "@smarthome/contracts";
import type {
  AreaKind,
  DeviceCategory,
  DeviceConnectionProtocol,
  DeviceLifecycle,
  DeviceRole,
  DeviceStatus,
  LoadClass,
  SensorIoType,
  SensorSignalType,
} from "@smarthome/contracts";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";

// ─── 시스템 기본정보 (Site/Building 이름) ──────────────────────────────
// M16 Admin — 범위는 이름 수정만(2026-07-10 합의, PROJECT_RULES 부록 A.1). 조직 계층
// (enterprise/site/building) 생성·삭제는 범위 밖 — enterprise는 단일 고정.

export interface SiteRecord {
  id: string;
  slug: string;
  name: string;
}

interface SiteRow extends QueryResultRow {
  id: string;
  slug: string;
  name: string;
}

function toSite(row: SiteRow): SiteRecord {
  return { id: row.id, slug: row.slug, name: row.name };
}

export async function listSites(db: QueryExecutor): Promise<SiteRecord[]> {
  const r = await db.query<SiteRow>(`SELECT id::text, slug, name FROM site ORDER BY name`);
  return r.rows.map(toSite);
}

export async function updateSiteName(
  db: QueryExecutor,
  id: string,
  name: string,
): Promise<SiteRecord | null> {
  const r = await db.query<SiteRow>(
    `UPDATE site SET name = $2 WHERE id::text = $1 RETURNING id::text, slug, name`,
    [id, name],
  );
  const row = r.rows[0];
  return row ? toSite(row) : null;
}

export interface BuildingRecord {
  id: string;
  siteId: string;
  slug: string;
  name: string;
}

interface BuildingRow extends QueryResultRow {
  id: string;
  site_id: string;
  slug: string;
  name: string;
}

function toBuilding(row: BuildingRow): BuildingRecord {
  return { id: row.id, siteId: row.site_id, slug: row.slug, name: row.name };
}

export async function listBuildings(db: QueryExecutor): Promise<BuildingRecord[]> {
  const r = await db.query<BuildingRow>(
    `SELECT id::text, site_id::text, slug, name FROM building ORDER BY name`,
  );
  return r.rows.map(toBuilding);
}

export async function updateBuildingName(
  db: QueryExecutor,
  id: string,
  name: string,
): Promise<BuildingRecord | null> {
  const r = await db.query<BuildingRow>(
    `UPDATE building SET name = $2 WHERE id::text = $1 RETURNING id::text, site_id::text, slug, name`,
    [id, name],
  );
  const row = r.rows[0];
  return row ? toBuilding(row) : null;
}

// ─── 공간 계층 (Spatial) ──────────────────────────────────────────────
// floor는 "지역"(area)에 붙는 메타 태그일 뿐이다(2026-07-15 합의) — 여러 지역이 같은 floor를
// 공유해 묶일 수 있고(전체 모니터링의 층별 집계용), 지역 자신은 area가 1차 관리 단위다. 배경
// 이미지도 floor가 아니라 area(image_id)가 직접 가진다 — floor_map 테이블/컬럼은 더 이상
// 애플리케이션에서 쓰지 않는다(스키마는 남겨두되 신규 코드는 참조하지 않음).

export interface FloorSummary {
  id: string;
  name: string;
  slug: string;
  buildingName: string;
  buildingSlug: string;
  siteName: string;
  siteSlug: string;
  topicPrefix: string; // "enterprise/site1/bldg-a/2f"
}

interface FloorSummaryRow extends QueryResultRow {
  id: string;
  name: string;
  slug: string;
  floor_slug: string;
  building_name: string;
  building_slug: string;
  site_name: string;
  site_slug: string;
}

function toFloorSummary(row: FloorSummaryRow): FloorSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    buildingName: row.building_name,
    buildingSlug: row.building_slug,
    siteName: row.site_name,
    siteSlug: row.site_slug,
    topicPrefix: [UNS_ROOT, row.site_slug, row.building_slug, row.floor_slug].join("/"),
  };
}

/** 층(=지역의 층 태그) 목록. 전체 모니터링의 층별 집계, 지역 생성 시 층 선택에 쓰인다. */
export async function listFloors(db: QueryExecutor): Promise<FloorSummary[]> {
  const r = await db.query<FloorSummaryRow>(
    `SELECT
       f.id::text AS id,
       f.name     AS name,
       f.slug     AS slug,
       f.slug     AS floor_slug,
       b.name     AS building_name,
       b.slug     AS building_slug,
       s.name     AS site_name,
       s.slug     AS site_slug
     FROM floor f
     JOIN building b  ON b.id = f.building_id
     JOIN site s      ON s.id = b.site_id
     ORDER BY s.slug, b.slug, f.name`,
  );
  return r.rows.map(toFloorSummary);
}

export interface CreateFloorInput {
  buildingId: string;
  slug: string;
  name: string;
}

/** 새 층 태그 생성. 지역(area) 생성 시 기존 층 태그가 없으면 호출부(service)가 함께 만든다. */
export async function insertFloor(db: QueryExecutor, input: CreateFloorInput): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO floor (building_id, slug, name) VALUES ($1,$2,$3) RETURNING id::text`,
    [input.buildingId, input.slug, input.name],
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("floor insert did not return an id");
  return id;
}

// ─── Area ─────────────────────────────────────────────────────────────

export interface Area {
  id: string;
  floorId: string;
  name: string;
  slug: string;
  topicPrefix: string; // "enterprise/site1/bldg-a/2f/living-room"
  polygon: unknown;
  kind: AreaKind;
  imageId: string | null;
  posX: number | null;
  posY: number | null;
}

interface AreaRow extends QueryResultRow {
  id: string;
  floor_id: string;
  name: string;
  slug: string;
  polygon: unknown;
  kind: AreaKind;
  image_id: string | null;
  pos_x: number | null;
  pos_y: number | null;
  site_slug: string;
  building_slug: string;
  floor_slug: string;
  area_slug: string;
}

function toArea(row: AreaRow): Area {
  return {
    id: row.id,
    floorId: row.floor_id,
    name: row.name,
    slug: row.slug,
    topicPrefix: [UNS_ROOT, row.site_slug, row.building_slug, row.floor_slug, row.area_slug].join("/"),
    polygon: row.polygon,
    kind: row.kind,
    imageId: row.image_id,
    posX: row.pos_x,
    posY: row.pos_y,
  };
}

/** listAreasByFloor / getAreaById 공통 SELECT 컬럼(분전반 필드 포함). */
const AREA_SELECT = `a.id::text, a.floor_id::text, a.name, a.slug, a.polygon,
            a.kind, a.image_id::text, a.pos_x, a.pos_y,
            s.slug AS site_slug, b.slug AS building_slug,
            f.slug AS floor_slug, a.slug AS area_slug`;

/** 특정 층의 Area 목록 (polygon 포함) */
export async function listAreasByFloor(
  db: QueryExecutor,
  floorId: string,
): Promise<Area[]> {
  const r = await db.query<AreaRow>(
    `SELECT ${AREA_SELECT}
     FROM area a
     JOIN floor f     ON f.id = a.floor_id
     JOIN building b  ON b.id = f.building_id
     JOIN site s      ON s.id = b.site_id
     WHERE a.floor_id::text = $1
     ORDER BY a.name`,
    [floorId],
  );
  return r.rows.map(toArea);
}

export async function getAreaById(db: QueryExecutor, id: string): Promise<Area | null> {
  const r = await db.query<AreaRow>(
    `SELECT ${AREA_SELECT}
     FROM area a
     JOIN floor f     ON f.id = a.floor_id
     JOIN building b  ON b.id = f.building_id
     JOIN site s      ON s.id = b.site_id
     WHERE a.id::text = $1`,
    [id],
  );
  const row = r.rows[0];
  return row ? toArea(row) : null;
}

/** M16 Admin — Area 생성(SRS 2.1.1). polygon은 최소 삼각형([[x,y],...] 3점 이상)을 기대하지만
 *  DB는 jsonb라 형태 검증은 API 레이어(zod)에서 한다. */
export interface CreateAreaInput {
  floorId: string;
  slug: string;
  name: string;
  polygon: unknown;
  createdBy: string | null;
  /** 분전반형 area(addendum §2.3). 미지정 시 DB 기본값 ROOM. */
  kind?: AreaKind;
  imageId?: string | null;
  posX?: number | null;
  posY?: number | null;
}

export async function createArea(db: QueryExecutor, input: CreateAreaInput): Promise<Area> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO area (floor_id, slug, name, polygon, created_by, kind, image_id, pos_x, pos_y)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'ROOM')::area_kind,$7,$8,$9)
     RETURNING id::text`,
    [
      input.floorId,
      input.slug,
      input.name,
      JSON.stringify(input.polygon),
      input.createdBy,
      input.kind ?? null,
      input.imageId ?? null,
      input.posX ?? null,
      input.posY ?? null,
    ],
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("area insert did not return an id");
  const created = await getAreaById(db, id);
  if (!created) throw new Error("area insert did not return a row");
  return created;
}

export interface UpdateAreaInput {
  name?: string;
  polygon?: unknown;
  kind?: AreaKind;
  imageId?: string | null;
  posX?: number | null;
  posY?: number | null;
}

export async function updateArea(
  db: QueryExecutor,
  id: string,
  input: UpdateAreaInput,
): Promise<Area | null> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  if (input.name !== undefined) {
    params.push(input.name);
    sets.push(`name = $${params.length}`);
  }
  if (input.polygon !== undefined) {
    params.push(JSON.stringify(input.polygon));
    sets.push(`polygon = $${params.length}`);
  }
  if (input.kind !== undefined) {
    params.push(input.kind);
    sets.push(`kind = $${params.length}::area_kind`);
  }
  if (input.imageId !== undefined) {
    params.push(input.imageId);
    sets.push(`image_id = $${params.length}`);
  }
  if (input.posX !== undefined) {
    params.push(input.posX);
    sets.push(`pos_x = $${params.length}`);
  }
  if (input.posY !== undefined) {
    params.push(input.posY);
    sets.push(`pos_y = $${params.length}`);
  }
  if (sets.length === 0) return getAreaById(db, id);

  await db.query(`UPDATE area SET ${sets.join(", ")} WHERE id::text = $1`, params);
  return getAreaById(db, id);
}

export async function deleteArea(db: QueryExecutor, id: string): Promise<boolean> {
  const r = await db.query(`DELETE FROM area WHERE id::text = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}

// ─── Area 목록/개요 (사용자 관점 "지역" 관리·관제 화면용) ────────────────────
// area가 1차 관리 단위이므로 floor 이름·건물/사업장 이름과 자기 배경 이미지(image_id 조인)를
// 함께 반환한다. kind='ROOM'만 "지역"으로 노출한다 — PANEL(분전반)은 별개 개념(2026-07-15 합의).

export interface AreaSummary {
  id: string;
  name: string;
  slug: string;
  kind: AreaKind;
  floorId: string;
  floorName: string;
  buildingName: string;
  siteName: string;
  topicPrefix: string; // "enterprise/site1/bldg-a/2f/living-room"
  imageId: string | null;
  imageUrl: string | null;
  imageWidthPx: number | null;
  imageHeightPx: number | null;
}

interface AreaSummaryRow extends QueryResultRow {
  id: string;
  name: string;
  slug: string;
  kind: AreaKind;
  floor_id: string;
  floor_name: string;
  floor_slug: string;
  building_name: string;
  building_slug: string;
  site_name: string;
  site_slug: string;
  image_id: string | null;
  image_url: string | null;
  image_width_px: number | null;
  image_height_px: number | null;
}

function toAreaSummary(row: AreaSummaryRow): AreaSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    floorId: row.floor_id,
    floorName: row.floor_name,
    buildingName: row.building_name,
    siteName: row.site_name,
    topicPrefix: [UNS_ROOT, row.site_slug, row.building_slug, row.floor_slug, row.slug].join("/"),
    imageId: row.image_id,
    imageUrl: row.image_url,
    imageWidthPx: row.image_width_px,
    imageHeightPx: row.image_height_px,
  };
}

const AREA_SUMMARY_SELECT = `
  a.id::text, a.name, a.slug, a.kind, a.image_id::text,
  f.id::text AS floor_id, f.name AS floor_name, f.slug AS floor_slug,
  b.name AS building_name, b.slug AS building_slug,
  s.name AS site_name, s.slug AS site_slug,
  img.image_url, img.width_px AS image_width_px, img.height_px AS image_height_px
  FROM area a
  JOIN floor f      ON f.id = a.floor_id
  JOIN building b   ON b.id = f.building_id
  JOIN site s       ON s.id = b.site_id
  LEFT JOIN image img ON img.id = a.image_id
`;

/** "지역" 목록(kind=ROOM만). PANEL(분전반)은 별개 개념이라 이 목록에 노출하지 않는다. */
export async function listAreas(db: QueryExecutor): Promise<AreaSummary[]> {
  const r = await db.query<AreaSummaryRow>(
    `SELECT ${AREA_SUMMARY_SELECT} WHERE a.kind = 'ROOM' ORDER BY s.slug, b.slug, f.name, a.name`,
  );
  return r.rows.map(toAreaSummary);
}

export async function getAreaSummaryById(db: QueryExecutor, id: string): Promise<AreaSummary | null> {
  const r = await db.query<AreaSummaryRow>(
    `SELECT ${AREA_SUMMARY_SELECT} WHERE a.id::text = $1`,
    [id],
  );
  const row = r.rows[0];
  return row ? toAreaSummary(row) : null;
}

export interface AreaOverview {
  area: AreaSummary;
  devices: DeviceListItem[];
}

/** 관제 화면(FloorMap)용 — 지역(area) 1개의 배경/기기 목록을 한 번에 조회. */
export async function getAreaOverview(db: QueryExecutor, areaId: string): Promise<AreaOverview | null> {
  const area = await getAreaSummaryById(db, areaId);
  if (!area) return null;

  const devices = await db.query<DeviceListRow>(
    `SELECT ${DEVICE_SELECT_COLUMNS}
     FROM device d
     LEFT JOIN area a      ON a.id = d.area_id
     LEFT JOIN floor f     ON f.id = a.floor_id
     LEFT JOIN building b  ON b.id = f.building_id
     LEFT JOIN site s      ON s.id = b.site_id
     WHERE d.area_id::text = $1
       AND d.monitoring_visible = true
       AND d.enabled = true
       AND d.lifecycle_status <> 'DECOMMISSIONED'
     ORDER BY d.name`,
    [areaId],
  );

  return { area, devices: devices.rows.map(toDeviceListItem) };
}

// ─── Device (목록/필터) ───────────────────────────────────────────────

export interface DeviceListItem {
  id: string;
  code: string;
  name: string;
  category: DeviceCategory;
  deviceRole: DeviceRole;
  deviceType: string | null;
  manufacturer: string | null;
  model: string | null;
  firmwareVersion: string | null;
  mqttTopic: string;
  currentStatus: DeviceStatus;
  lifecycleStatus: DeviceLifecycle;
  monitoringVisible: boolean;
  enabled: boolean;
  simulated: boolean;
  parentDeviceId: string | null;
  sensorSignalType: SensorSignalType | null;
  sensorIoType: SensorIoType | null;
  channelAddress: string | null;
  terminalBlock: string | null;
  loadClass: LoadClass | null;
  areaId: string | null;
  areaTopicPrefix: string | null; // "enterprise/site1/bldg-a/2f/living-room"
  posX: string | null;
  posY: string | null;
  connectionProtocol: DeviceConnectionProtocol | null;
  connectionConfig: unknown;
  updatedAt: Date;
}

interface DeviceListRow extends QueryResultRow {
  id: string;
  code: string;
  name: string;
  category: DeviceCategory;
  device_role: DeviceRole;
  device_type: string | null;
  manufacturer: string | null;
  model: string | null;
  firmware_version: string | null;
  mqtt_topic: string;
  current_status: DeviceStatus;
  lifecycle_status: DeviceLifecycle;
  monitoring_visible: boolean;
  enabled: boolean;
  simulated: boolean;
  parent_device_id: string | null;
  sensor_signal_type: SensorSignalType | null;
  sensor_io_type: SensorIoType | null;
  channel_address: string | null;
  terminal_block: string | null;
  load_class: LoadClass | null;
  area_id: string | null;
  area_topic_prefix: string | null;
  pos_x: string | null;
  pos_y: string | null;
  connection_protocol: DeviceConnectionProtocol | null;
  connection_config: unknown;
  updated_at: Date;
}

function toDeviceListItem(row: DeviceListRow): DeviceListItem {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    deviceRole: row.device_role,
    deviceType: row.device_type,
    manufacturer: row.manufacturer,
    model: row.model,
    firmwareVersion: row.firmware_version,
    mqttTopic: row.mqtt_topic,
    currentStatus: row.current_status,
    lifecycleStatus: row.lifecycle_status,
    monitoringVisible: row.monitoring_visible,
    enabled: row.enabled,
    simulated: row.simulated,
    parentDeviceId: row.parent_device_id,
    sensorSignalType: row.sensor_signal_type,
    sensorIoType: row.sensor_io_type,
    channelAddress: row.channel_address,
    terminalBlock: row.terminal_block,
    loadClass: row.load_class,
    areaId: row.area_id,
    areaTopicPrefix: row.area_topic_prefix,
    posX: row.pos_x,
    posY: row.pos_y,
    connectionProtocol: row.connection_protocol,
    connectionConfig: row.connection_config,
    updatedAt: row.updated_at,
  };
}

const DEVICE_SELECT_COLUMNS = `
  d.id::text, d.code, d.name, d.category, d.device_role, d.device_type, d.manufacturer, d.model,
  d.firmware_version, d.mqtt_topic, d.current_status, d.lifecycle_status,
  d.monitoring_visible, d.enabled, d.simulated, d.parent_device_id::text, d.sensor_signal_type, d.sensor_io_type,
  d.channel_address, d.terminal_block, d.load_class, d.area_id::text, d.pos_x::text, d.pos_y::text,
  d.connection_protocol, d.connection_config,
  d.updated_at,
  CASE
    WHEN a.id IS NOT NULL THEN
      CONCAT('enterprise/', s.slug, '/', b.slug, '/', f.slug, '/', a.slug)
    ELSE NULL
  END AS area_topic_prefix
`;

export interface DeviceListFilter {
  areaId?: string;
  category?: string;
  status?: string;
  groupId?: string;
}

/** 기기 목록 조회 (필터: areaId, category, status, groupId) */
export async function listDevices(
  db: QueryExecutor,
  filter: DeviceListFilter = {},
): Promise<DeviceListItem[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const joins: string[] = [];

  if (filter.areaId) {
    params.push(filter.areaId);
    conditions.push(`d.area_id::text = $${params.length}`);
  }
  if (filter.category) {
    params.push(filter.category);
    conditions.push(`d.category = $${params.length}::device_category`);
  }
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`d.current_status = $${params.length}::device_status`);
  }
  if (filter.groupId) {
    joins.push(`JOIN device_group_mapping dgm ON dgm.device_id = d.id`);
    params.push(filter.groupId);
    conditions.push(`dgm.group_id::text = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const r = await db.query<DeviceListRow>(
    `SELECT ${DEVICE_SELECT_COLUMNS}
     FROM device d
     ${joins.join("\n")}
     LEFT JOIN area a      ON a.id = d.area_id
     LEFT JOIN floor f     ON f.id = a.floor_id
     LEFT JOIN building b  ON b.id = f.building_id
     LEFT JOIN site s      ON s.id = b.site_id
     ${where}
     ORDER BY d.name`,
    params,
  );
  return r.rows.map(toDeviceListItem);
}

