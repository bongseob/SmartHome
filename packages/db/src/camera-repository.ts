import type { CameraProtocol, DeviceStatus } from "@smarthome/contracts";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";

// ─── Camera (device 1:1 확장, architecture.md §5-cam) ──────────────────────
// camera는 category=CAMERA인 device의 확장 테이블(FK=device_id). device row 자체는
// device-repository.ts의 createDevice/getDeviceState로 다루고, 여기서는 카메라 전용
// 필드(스트림/PTZ/설치 방향)만 다룬다.

export interface CameraRecord {
  deviceId: string;
  protocol: CameraProtocol;
  streamUrl: string;
  onvifEndpoint: string | null;
  isPtz: boolean;
  resolution: string | null;
  fovDeg: number | null;
  headingDeg: number | null;
  /** 게이트웨이 카메라 어댑터가 ONVIF 로그인에 쓴다 — CameraSummary(API 응답)에는 절대 포함하지
   *  않는다(비밀번호 노출 방지). CameraRecord/getCameraByDeviceId는 내부(gateway) 전용 경로다. */
  onvifUsername: string | null;
  onvifPassword: string | null;
}

interface CameraRow extends QueryResultRow {
  device_id: string;
  protocol: CameraProtocol;
  stream_url: string;
  onvif_endpoint: string | null;
  is_ptz: boolean;
  resolution: string | null;
  fov_deg: string | null;
  heading_deg: string | null;
  onvif_username: string | null;
  onvif_password: string | null;
}

function toCamera(row: CameraRow): CameraRecord {
  return {
    deviceId: row.device_id,
    protocol: row.protocol,
    streamUrl: row.stream_url,
    onvifEndpoint: row.onvif_endpoint,
    isPtz: row.is_ptz,
    resolution: row.resolution,
    fovDeg: row.fov_deg === null ? null : Number(row.fov_deg),
    headingDeg: row.heading_deg === null ? null : Number(row.heading_deg),
    onvifUsername: row.onvif_username,
    onvifPassword: row.onvif_password,
  };
}

const CAMERA_COLUMNS = `
  device_id::text, protocol, stream_url, onvif_endpoint, is_ptz, resolution,
  fov_deg::text, heading_deg::text, onvif_username, onvif_password
`;

export interface InsertCameraInput {
  deviceId: string;
  protocol: CameraProtocol;
  streamUrl: string;
  onvifEndpoint?: string | null;
  isPtz?: boolean;
  resolution?: string | null;
  fovDeg?: number | null;
  headingDeg?: number | null;
  onvifUsername?: string | null;
  onvifPassword?: string | null;
}

/** device row(category=CAMERA)가 먼저 있어야 한다 — 호출부(CamerasService)가 같은 transaction에서
 *  createDevice() 다음에 이 함수를 호출한다. */
export async function insertCamera(db: QueryExecutor, input: InsertCameraInput): Promise<CameraRecord> {
  const r = await db.query<CameraRow>(
    `INSERT INTO camera (device_id, protocol, stream_url, onvif_endpoint, is_ptz, resolution, fov_deg, heading_deg, onvif_username, onvif_password)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING ${CAMERA_COLUMNS}`,
    [
      input.deviceId,
      input.protocol,
      input.streamUrl,
      input.onvifEndpoint ?? null,
      input.isPtz ?? false,
      input.resolution ?? null,
      input.fovDeg ?? null,
      input.headingDeg ?? null,
      input.onvifUsername ?? null,
      input.onvifPassword ?? null,
    ],
  );
  const row = r.rows[0];
  if (!row) throw new Error("camera insert did not return a row");
  return toCamera(row);
}

export async function getCameraByDeviceId(db: QueryExecutor, deviceId: string): Promise<CameraRecord | null> {
  const r = await db.query<CameraRow>(
    `SELECT ${CAMERA_COLUMNS} FROM camera WHERE device_id::text = $1`,
    [deviceId],
  );
  const row = r.rows[0];
  return row ? toCamera(row) : null;
}

export interface UpdateCameraInput {
  streamUrl?: string;
  onvifEndpoint?: string | null;
  isPtz?: boolean;
  resolution?: string | null;
  fovDeg?: number | null;
  headingDeg?: number | null;
  onvifUsername?: string | null;
  onvifPassword?: string | null;
}

/** 스트림·PTZ·설치 방향 설정 수정(protocol은 불변 — 바뀌면 카메라를 다시 등록). */
export async function updateCamera(
  db: QueryExecutor,
  deviceId: string,
  input: UpdateCameraInput,
): Promise<CameraRecord | null> {
  const sets: string[] = [];
  const params: unknown[] = [deviceId];
  if (input.streamUrl !== undefined) {
    params.push(input.streamUrl);
    sets.push(`stream_url = $${params.length}`);
  }
  if (input.onvifEndpoint !== undefined) {
    params.push(input.onvifEndpoint);
    sets.push(`onvif_endpoint = $${params.length}`);
  }
  if (input.isPtz !== undefined) {
    params.push(input.isPtz);
    sets.push(`is_ptz = $${params.length}`);
  }
  if (input.resolution !== undefined) {
    params.push(input.resolution);
    sets.push(`resolution = $${params.length}`);
  }
  if (input.fovDeg !== undefined) {
    params.push(input.fovDeg);
    sets.push(`fov_deg = $${params.length}`);
  }
  if (input.headingDeg !== undefined) {
    params.push(input.headingDeg);
    sets.push(`heading_deg = $${params.length}`);
  }
  if (input.onvifUsername !== undefined) {
    params.push(input.onvifUsername);
    sets.push(`onvif_username = $${params.length}`);
  }
  if (input.onvifPassword !== undefined) {
    params.push(input.onvifPassword);
    sets.push(`onvif_password = $${params.length}`);
  }
  if (sets.length === 0) return getCameraByDeviceId(db, deviceId);

  const r = await db.query<CameraRow>(
    `UPDATE camera SET ${sets.join(", ")} WHERE device_id::text = $1 RETURNING ${CAMERA_COLUMNS}`,
    params,
  );
  const row = r.rows[0];
  return row ? toCamera(row) : null;
}

// ─── 카메라 목록 (device + camera 조인) ─────────────────────────────────────

export interface CameraSummary {
  deviceId: string;
  code: string;
  name: string;
  currentStatus: DeviceStatus;
  areaId: string | null;
  /** area 스코프 ACL 검사용(devices.service.ts의 list() 필터링과 동일 패턴). */
  areaTopicPrefix: string | null;
  protocol: CameraProtocol;
  streamUrl: string;
  onvifEndpoint: string | null;
  isPtz: boolean;
  resolution: string | null;
  fovDeg: number | null;
  headingDeg: number | null;
}

interface CameraSummaryRow extends QueryResultRow {
  device_id: string;
  code: string;
  name: string;
  current_status: DeviceStatus;
  area_id: string | null;
  area_topic_prefix: string | null;
  protocol: CameraProtocol;
  stream_url: string;
  onvif_endpoint: string | null;
  is_ptz: boolean;
  resolution: string | null;
  fov_deg: string | null;
  heading_deg: string | null;
}

function toCameraSummary(row: CameraSummaryRow): CameraSummary {
  return {
    deviceId: row.device_id,
    code: row.code,
    name: row.name,
    currentStatus: row.current_status,
    areaId: row.area_id,
    areaTopicPrefix: row.area_topic_prefix,
    protocol: row.protocol,
    streamUrl: row.stream_url,
    onvifEndpoint: row.onvif_endpoint,
    isPtz: row.is_ptz,
    resolution: row.resolution,
    fovDeg: row.fov_deg === null ? null : Number(row.fov_deg),
    headingDeg: row.heading_deg === null ? null : Number(row.heading_deg),
  };
}

const CAMERA_SUMMARY_COLUMNS = `
  d.id::text AS device_id, d.code, d.name, d.current_status, d.area_id::text,
  CASE
    WHEN a.id IS NOT NULL THEN
      CONCAT('enterprise/', s.slug, '/', b.slug, '/', f.slug, '/', a.slug)
    ELSE NULL
  END AS area_topic_prefix,
  c.protocol, c.stream_url, c.onvif_endpoint, c.is_ptz, c.resolution,
  c.fov_deg::text, c.heading_deg::text
`;

export interface CameraListFilter {
  areaId?: string;
  isPtz?: boolean;
}

/** api-spec.md §4-cam `GET /cameras(?areaId&isPtz)` — device(category=CAMERA)+camera 조인.
 *  areaId 필터는 카메라 설치 위치(device.area_id)가 아니라 화각이 커버하는 지역
 *  (camera_coverage)을 기준으로 한다 — 카메라는 다른 지역에 설치돼도 그 지역을 비출 수 있다. */
export async function listCameras(db: QueryExecutor, filter: CameraListFilter = {}): Promise<CameraSummary[]> {
  const conditions: string[] = [`d.lifecycle_status <> 'DECOMMISSIONED'`];
  const params: unknown[] = [];
  const joins: string[] = [];

  if (filter.areaId) {
    joins.push(`JOIN camera_coverage cc ON cc.camera_id = c.device_id`);
    params.push(filter.areaId);
    conditions.push(`cc.area_id::text = $${params.length}`);
  }
  if (filter.isPtz !== undefined) {
    params.push(filter.isPtz);
    conditions.push(`c.is_ptz = $${params.length}`);
  }

  const r = await db.query<CameraSummaryRow>(
    `SELECT DISTINCT ${CAMERA_SUMMARY_COLUMNS}
     FROM camera c
     JOIN device d       ON d.id = c.device_id
     LEFT JOIN area a    ON a.id = d.area_id
     LEFT JOIN floor f   ON f.id = a.floor_id
     LEFT JOIN building b ON b.id = f.building_id
     LEFT JOIN site s    ON s.id = b.site_id
     ${joins.join("\n")}
     WHERE ${conditions.join(" AND ")}
     ORDER BY d.name`,
    params,
  );
  return r.rows.map(toCameraSummary);
}

/** 단건 조회 — CamerasService.get()/update() 후 응답 재구성에 쓴다. */
export async function getCameraSummaryByDeviceId(db: QueryExecutor, deviceId: string): Promise<CameraSummary | null> {
  const r = await db.query<CameraSummaryRow>(
    `SELECT ${CAMERA_SUMMARY_COLUMNS}
     FROM camera c
     JOIN device d       ON d.id = c.device_id
     LEFT JOIN area a    ON a.id = d.area_id
     LEFT JOIN floor f   ON f.id = a.floor_id
     LEFT JOIN building b ON b.id = f.building_id
     LEFT JOIN site s    ON s.id = b.site_id
     WHERE d.id::text = $1`,
    [deviceId],
  );
  const row = r.rows[0];
  return row ? toCameraSummary(row) : null;
}

/** 알람 발생원(Area)을 커버하는 카메라 목록(현장 확인용, api-spec.md `GET /alarms/:id/cameras`). */
export async function listCamerasCoveringArea(db: QueryExecutor, areaId: string): Promise<CameraSummary[]> {
  return listCameras(db, { areaId });
}

// ─── Camera Preset (PTZ 프리셋) ─────────────────────────────────────────────

export interface CameraPresetRecord {
  id: string;
  cameraId: string;
  name: string;
  pan: number | null;
  tilt: number | null;
  zoom: number | null;
  createdBy: string | null;
}

interface CameraPresetRow extends QueryResultRow {
  id: string;
  camera_id: string;
  name: string;
  pan: string | null;
  tilt: string | null;
  zoom: string | null;
  created_by: string | null;
}

function toCameraPreset(row: CameraPresetRow): CameraPresetRecord {
  return {
    id: row.id,
    cameraId: row.camera_id,
    name: row.name,
    pan: row.pan === null ? null : Number(row.pan),
    tilt: row.tilt === null ? null : Number(row.tilt),
    zoom: row.zoom === null ? null : Number(row.zoom),
    createdBy: row.created_by,
  };
}

const CAMERA_PRESET_COLUMNS = `id::text, camera_id::text, name, pan::text, tilt::text, zoom::text, created_by::text`;

export interface CreateCameraPresetInput {
  cameraId: string;
  name: string;
  pan?: number | null;
  tilt?: number | null;
  zoom?: number | null;
  createdBy?: string | null;
}

export async function createCameraPreset(
  db: QueryExecutor,
  input: CreateCameraPresetInput,
): Promise<CameraPresetRecord> {
  const r = await db.query<CameraPresetRow>(
    `INSERT INTO camera_preset (camera_id, name, pan, tilt, zoom, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING ${CAMERA_PRESET_COLUMNS}`,
    [input.cameraId, input.name, input.pan ?? null, input.tilt ?? null, input.zoom ?? null, input.createdBy ?? null],
  );
  const row = r.rows[0];
  if (!row) throw new Error("camera_preset insert did not return a row");
  return toCameraPreset(row);
}

export async function listCameraPresets(db: QueryExecutor, cameraId: string): Promise<CameraPresetRecord[]> {
  const r = await db.query<CameraPresetRow>(
    `SELECT ${CAMERA_PRESET_COLUMNS} FROM camera_preset WHERE camera_id::text = $1 ORDER BY name`,
    [cameraId],
  );
  return r.rows.map(toCameraPreset);
}

export async function getCameraPresetById(db: QueryExecutor, id: string): Promise<CameraPresetRecord | null> {
  const r = await db.query<CameraPresetRow>(
    `SELECT ${CAMERA_PRESET_COLUMNS} FROM camera_preset WHERE id::text = $1`,
    [id],
  );
  const row = r.rows[0];
  return row ? toCameraPreset(row) : null;
}

// ─── Camera Coverage (카메라 화각이 커버하는 Area, N:M) ─────────────────────

/** 이미 매핑돼 있으면 조용히 무시(PUT의 멱등성). */
export async function addCameraCoverage(db: QueryExecutor, cameraId: string, areaId: string): Promise<void> {
  await db.query(
    `INSERT INTO camera_coverage (camera_id, area_id) VALUES ($1,$2)
     ON CONFLICT (camera_id, area_id) DO NOTHING`,
    [cameraId, areaId],
  );
}

export async function removeCameraCoverage(db: QueryExecutor, cameraId: string, areaId: string): Promise<void> {
  await db.query(`DELETE FROM camera_coverage WHERE camera_id::text = $1 AND area_id::text = $2`, [
    cameraId,
    areaId,
  ]);
}

export async function listCameraCoverageAreaIds(db: QueryExecutor, cameraId: string): Promise<string[]> {
  const r = await db.query<{ area_id: string }>(
    `SELECT area_id::text FROM camera_coverage WHERE camera_id::text = $1`,
    [cameraId],
  );
  return r.rows.map((row) => row.area_id);
}
