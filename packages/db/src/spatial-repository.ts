import { UNS_ROOT } from "@smarthome/contracts";
import type {
  DeviceCategory,
  DeviceConnectionProtocol,
  DeviceLifecycle,
  DeviceStatus,
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

// ─── 도면(Floor Map) 관리 (M16 — 로컬 파일시스템 저장, PROJECT_RULES 부록 A.1) ─────

export interface FloorMapRecord {
  id: string;
  imageUrl: string;
  widthPx: number | null;
  heightPx: number | null;
  scaleMPerPx: string | null;
  uploadedBy: string | null;
  uploadedAt: Date;
}

interface FloorMapRow extends QueryResultRow {
  id: string;
  image_url: string;
  width_px: number | null;
  height_px: number | null;
  scale_m_per_px: string | null;
  uploaded_by: string | null;
  uploaded_at: Date;
}

function toFloorMap(row: FloorMapRow): FloorMapRecord {
  return {
    id: row.id,
    imageUrl: row.image_url,
    widthPx: row.width_px,
    heightPx: row.height_px,
    scaleMPerPx: row.scale_m_per_px,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
  };
}

const FLOOR_MAP_COLUMNS = `
  id::text, image_url, width_px, height_px, scale_m_per_px::text, uploaded_by::text, uploaded_at
`;

export interface InsertFloorMapInput {
  imageUrl: string;
  widthPx: number;
  heightPx: number;
  scaleMPerPx: number;
  uploadedBy: string | null;
}

export async function insertFloorMap(
  db: QueryExecutor,
  input: InsertFloorMapInput,
): Promise<FloorMapRecord> {
  const r = await db.query<FloorMapRow>(
    `INSERT INTO floor_map (image_url, width_px, height_px, scale_m_per_px, uploaded_by)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING ${FLOOR_MAP_COLUMNS}`,
    [input.imageUrl, input.widthPx, input.heightPx, input.scaleMPerPx, input.uploadedBy],
  );
  const row = r.rows[0];
  if (!row) throw new Error("floor_map insert did not return a row");
  return toFloorMap(row);
}

export async function updateFloorMapScale(
  db: QueryExecutor,
  id: string,
  scaleMPerPx: number,
): Promise<FloorMapRecord | null> {
  const r = await db.query<FloorMapRow>(
    `UPDATE floor_map SET scale_m_per_px = $2 WHERE id::text = $1 RETURNING ${FLOOR_MAP_COLUMNS}`,
    [id, scaleMPerPx],
  );
  const row = r.rows[0];
  return row ? toFloorMap(row) : null;
}

/** 층에 새/기존 floor_map을 연결한다(도면 업로드·교체). */
export async function setFloorFloorMap(
  db: QueryExecutor,
  floorId: string,
  floorMapId: string,
): Promise<void> {
  await db.query(`UPDATE floor SET floor_map_id = $2 WHERE id::text = $1`, [floorId, floorMapId]);
}

// ─── 공간 계층 (Spatial) ──────────────────────────────────────────────

export interface FloorSummary {
  id: string;
  name: string;
  slug: string;
  buildingName: string;
  buildingSlug: string;
  siteName: string;
  siteSlug: string;
  topicPrefix: string; // "enterprise/site1/bldg-a/2f"
  floorMapId: string | null;
  floorMapUrl: string | null;
  floorMapWidth: number | null;
  floorMapHeight: number | null;
  floorMapScale: string | null;
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
  floor_map_id: string | null;
  floor_map_url: string | null;
  floor_map_width: number | null;
  floor_map_height: number | null;
  floor_map_scale: string | null;
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
    floorMapId: row.floor_map_id,
    floorMapUrl: row.floor_map_url,
    floorMapWidth: row.floor_map_width,
    floorMapHeight: row.floor_map_height,
    floorMapScale: row.floor_map_scale,
  };
}

/** 전체 층 목록 (floor_map 정보 포함) */
export async function listFloors(db: QueryExecutor): Promise<FloorSummary[]> {
  const r = await db.query<FloorSummaryRow>(
    `SELECT
       f.id::text         AS id,
       f.name             AS name,
       f.slug             AS slug,
       f.slug             AS floor_slug,
       b.name             AS building_name,
       b.slug             AS building_slug,
       s.name             AS site_name,
       s.slug             AS site_slug,
       fm.id::text        AS floor_map_id,
       fm.image_url       AS floor_map_url,
       fm.width_px        AS floor_map_width,
       fm.height_px       AS floor_map_height,
       fm.scale_m_per_px::text AS floor_map_scale
     FROM floor f
     JOIN building b  ON b.id = f.building_id
     JOIN site s      ON s.id = b.site_id
     LEFT JOIN floor_map fm ON fm.id = f.floor_map_id
     ORDER BY s.slug, b.slug, f.name`,
  );
  return r.rows.map(toFloorSummary);
}

// ─── Area ─────────────────────────────────────────────────────────────

export interface Area {
  id: string;
  floorId: string;
  name: string;
  slug: string;
  topicPrefix: string; // "enterprise/site1/bldg-a/2f/living-room"
  polygon: unknown;
}

interface AreaRow extends QueryResultRow {
  id: string;
  floor_id: string;
  name: string;
  slug: string;
  polygon: unknown;
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
  };
}

/** 특정 층의 Area 목록 (polygon 포함) */
export async function listAreasByFloor(
  db: QueryExecutor,
  floorId: string,
): Promise<Area[]> {
  const r = await db.query<AreaRow>(
    `SELECT a.id::text, a.floor_id::text, a.name, a.slug, a.polygon,
            s.slug AS site_slug, b.slug AS building_slug,
            f.slug AS floor_slug, a.slug AS area_slug
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
    `SELECT a.id::text, a.floor_id::text, a.name, a.slug, a.polygon,
            s.slug AS site_slug, b.slug AS building_slug,
            f.slug AS floor_slug, a.slug AS area_slug
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
}

export async function createArea(db: QueryExecutor, input: CreateAreaInput): Promise<Area> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO area (floor_id, slug, name, polygon, created_by)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id::text`,
    [input.floorId, input.slug, input.name, JSON.stringify(input.polygon), input.createdBy],
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
  if (sets.length === 0) return getAreaById(db, id);

  await db.query(`UPDATE area SET ${sets.join(", ")} WHERE id::text = $1`, params);
  return getAreaById(db, id);
}

export async function deleteArea(db: QueryExecutor, id: string): Promise<boolean> {
  const r = await db.query(`DELETE FROM area WHERE id::text = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}

// ─── Device (목록/필터) ───────────────────────────────────────────────

export interface DeviceListItem {
  id: string;
  code: string;
  name: string;
  category: DeviceCategory;
  deviceType: string | null;
  manufacturer: string | null;
  model: string | null;
  firmwareVersion: string | null;
  mqttTopic: string;
  currentStatus: DeviceStatus;
  lifecycleStatus: DeviceLifecycle;
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
  device_type: string | null;
  manufacturer: string | null;
  model: string | null;
  firmware_version: string | null;
  mqtt_topic: string;
  current_status: DeviceStatus;
  lifecycle_status: DeviceLifecycle;
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
    deviceType: row.device_type,
    manufacturer: row.manufacturer,
    model: row.model,
    firmwareVersion: row.firmware_version,
    mqttTopic: row.mqtt_topic,
    currentStatus: row.current_status,
    lifecycleStatus: row.lifecycle_status,
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
  d.id::text, d.code, d.name, d.category, d.device_type, d.manufacturer, d.model,
  d.firmware_version, d.mqtt_topic, d.current_status, d.lifecycle_status,
  d.area_id::text, d.pos_x::text, d.pos_y::text, d.connection_protocol, d.connection_config,
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
}

/** 기기 목록 조회 (필터: areaId, category, status) */
export async function listDevices(
  db: QueryExecutor,
  filter: DeviceListFilter = {},
): Promise<DeviceListItem[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

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

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const r = await db.query<DeviceListRow>(
    `SELECT ${DEVICE_SELECT_COLUMNS}
     FROM device d
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

// ─── Floor Overview (대시보드용) ──────────────────────────────────────

export interface FloorOverview {
  floor: FloorSummary;
  areas: Area[];
  devices: DeviceListItem[];
}

/** 특정 층의 floor_map + Area(polygon) + Device 목록을 한 번에 조회 */
export async function getFloorOverview(
  db: QueryExecutor,
  floorId: string,
): Promise<FloorOverview | null> {
  const [floors, areas, devices] = await Promise.all([
    listFloors(db),
    listAreasByFloor(db, floorId),
    db.query<DeviceListRow>(
      `SELECT ${DEVICE_SELECT_COLUMNS}
       FROM device d
       LEFT JOIN area a      ON a.id = d.area_id
       LEFT JOIN floor f     ON f.id = a.floor_id
       LEFT JOIN building b  ON b.id = f.building_id
       LEFT JOIN site s      ON s.id = b.site_id
       WHERE d.area_id IN (SELECT id FROM area WHERE floor_id::text = $1)
       ORDER BY d.name`,
      [floorId],
    ),
  ]);

  const floor = floors.find((f) => f.id === floorId);
  if (!floor) return null;

  return {
    floor,
    areas,
    devices: devices.rows.map(toDeviceListItem),
  };
}
