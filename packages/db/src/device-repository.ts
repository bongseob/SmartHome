import type {
  AlarmState,
  AlarmTier,
  DeviceCategory,
  DeviceConnectionProtocol,
  DeviceLifecycle,
  DeviceRole,
  DeviceStatus,
  ExecutionStatus,
  LoadClass,
  SensorIoType,
  SensorSignalType,
  Severity,
} from "@smarthome/contracts";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";

export interface DeviceStateRecord {
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
  parentDeviceId: string | null;
  sensorSignalType: SensorSignalType | null;
  sensorIoType: SensorIoType | null;
  channelAddress: string | null;
  terminalBlock: string | null;
  /** 부하 구분(일반/비상/예비, addendum §3.2). 미설정이면 null. */
  loadClass: LoadClass | null;
  description: string | null;
  areaId: string | null;
  posX: string | null;
  posY: string | null;
  gatewayId: string | null;
  /** Device↔Gateway 연결 프로토콜(선택). Gateway↔플랫폼 구간은 항상 MQTT — 이 값과 무관하다. */
  connectionProtocol: DeviceConnectionProtocol | null;
  connectionConfig: unknown;
  updatedAt: Date;
}

export interface DeviceCommandHistoryRecord {
  kind: "COMMAND";
  commandId: string;
  sessionId: string;
  command: string;
  status: ExecutionStatus;
  mqttReasonCode: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeviceAuditHistoryRecord {
  kind: "AUDIT";
  logId: string;
  ts: Date;
  actorType: string;
  actorId: string | null;
  command: string | null;
  reason: string | null;
  executionStatus: ExecutionStatus | null;
  mqttReasonCode: number | null;
  commandId: string | null;
}

export interface DeviceAlarmHistoryRecord {
  kind: "ALARM";
  alarmId: string;
  tier: AlarmTier;
  severity: Severity;
  message: string | null;
  state: AlarmState;
  raisedAt: Date;
  snoozedUntil: Date | null;
  resolvedAt: Date | null;
}

export interface DeviceHistory {
  device: Pick<DeviceStateRecord, "id" | "code" | "name" | "currentStatus">;
  commands: DeviceCommandHistoryRecord[];
  audits: DeviceAuditHistoryRecord[];
  alarms: DeviceAlarmHistoryRecord[];
}

interface DeviceStateRow extends QueryResultRow {
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
  parent_device_id: string | null;
  sensor_signal_type: SensorSignalType | null;
  sensor_io_type: SensorIoType | null;
  channel_address: string | null;
  terminal_block: string | null;
  load_class: LoadClass | null;
  description: string | null;
  area_id: string | null;
  pos_x: string | null;
  pos_y: string | null;
  gateway_id: string | null;
  connection_protocol: DeviceConnectionProtocol | null;
  connection_config: unknown;
  updated_at: Date;
}

interface DeviceCommandHistoryRow extends QueryResultRow {
  command_id: string;
  session_id: string;
  command: string;
  status: ExecutionStatus;
  mqtt_reason_code: number | null;
  created_at: Date;
  updated_at: Date;
}

interface DeviceAuditHistoryRow extends QueryResultRow {
  log_id: string;
  ts: Date;
  actor_type: string;
  actor_id: string | null;
  command: string | null;
  reason: string | null;
  execution_status: ExecutionStatus | null;
  mqtt_reason_code: number | null;
  command_id: string | null;
}

interface DeviceAlarmHistoryRow extends QueryResultRow {
  id: string;
  tier: AlarmTier;
  severity: Severity;
  message: string | null;
  state: AlarmState;
  raised_at: Date;
  snoozed_until: Date | null;
  resolved_at: Date | null;
}

const DEVICE_COLUMNS = `
  id::text, code, name, category, device_role, device_type, manufacturer, model, firmware_version,
  mqtt_topic, current_status, lifecycle_status, area_id::text, pos_x::text, pos_y::text,
  monitoring_visible, enabled, parent_device_id::text, sensor_signal_type, sensor_io_type,
  channel_address, terminal_block, load_class, description, gateway_id::text, connection_protocol, connection_config, updated_at
`;

function toDeviceState(row: DeviceStateRow): DeviceStateRecord {
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
    parentDeviceId: row.parent_device_id,
    sensorSignalType: row.sensor_signal_type,
    sensorIoType: row.sensor_io_type,
    channelAddress: row.channel_address,
    terminalBlock: row.terminal_block,
    loadClass: row.load_class,
    description: row.description,
    areaId: row.area_id,
    posX: row.pos_x,
    posY: row.pos_y,
    gatewayId: row.gateway_id,
    connectionProtocol: row.connection_protocol,
    connectionConfig: row.connection_config,
    updatedAt: row.updated_at,
  };
}

function toCommandHistory(row: DeviceCommandHistoryRow): DeviceCommandHistoryRecord {
  return {
    kind: "COMMAND",
    commandId: row.command_id,
    sessionId: row.session_id,
    command: row.command,
    status: row.status,
    mqttReasonCode: row.mqtt_reason_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAuditHistory(row: DeviceAuditHistoryRow): DeviceAuditHistoryRecord {
  return {
    kind: "AUDIT",
    logId: row.log_id,
    ts: row.ts,
    actorType: row.actor_type,
    actorId: row.actor_id,
    command: row.command,
    reason: row.reason,
    executionStatus: row.execution_status,
    mqttReasonCode: row.mqtt_reason_code,
    commandId: row.command_id,
  };
}

function toAlarmHistory(row: DeviceAlarmHistoryRow): DeviceAlarmHistoryRecord {
  return {
    kind: "ALARM",
    alarmId: row.id,
    tier: row.tier,
    severity: row.severity,
    message: row.message,
    state: row.state,
    raisedAt: row.raised_at,
    snoozedUntil: row.snoozed_until,
    resolvedAt: row.resolved_at,
  };
}

export async function getDeviceState(
  db: QueryExecutor,
  idOrCode: string,
): Promise<DeviceStateRecord | null> {
  const result = await db.query<DeviceStateRow>(
    `SELECT ${DEVICE_COLUMNS}
     FROM device
     WHERE id::text = $1 OR code = $1
     LIMIT 1`,
    [idOrCode],
  );
  const row = result.rows[0];
  return row ? toDeviceState(row) : null;
}

/** 도면 편집 모드 — 기기 좌표 갱신(SRS 3.2, ui-ux-design.md §4.1-mode). */
export async function updateDevicePosition(
  db: QueryExecutor,
  deviceId: string,
  posX: number,
  posY: number,
): Promise<DeviceStateRecord | null> {
  const result = await db.query<DeviceStateRow>(
    `UPDATE device
     SET pos_x = $2, pos_y = $3, updated_at = now()
     WHERE id::text = $1
     RETURNING ${DEVICE_COLUMNS}`,
    [deviceId, posX, posY],
  );
  const row = result.rows[0];
  return row ? toDeviceState(row) : null;
}

/**
 * Device↔Gateway 연결 프로토콜/파라미터 설정(SRS 2.1.2·3.1.1, PROJECT_RULES 부록 A.1).
 * Gateway↔플랫폼 구간(MQTT)에는 영향 없음 — 어떤 물리 프로토콜의 기기를 Gateway가 브리징하는지
 * 기록/관리하는 용도다. null을 넘기면 설정을 해제한다(레거시/직결 MQTT 기기로 되돌림).
 */
export async function updateDeviceConnection(
  db: QueryExecutor,
  deviceId: string,
  connectionProtocol: DeviceConnectionProtocol | null,
  connectionConfig: unknown,
): Promise<DeviceStateRecord | null> {
  const result = await db.query<DeviceStateRow>(
    `UPDATE device
     SET connection_protocol = $2, connection_config = $3, updated_at = now()
     WHERE id::text = $1
     RETURNING ${DEVICE_COLUMNS}`,
    [deviceId, connectionProtocol, connectionConfig === null ? null : JSON.stringify(connectionConfig)],
  );
  const row = result.rows[0];
  return row ? toDeviceState(row) : null;
}

export async function updateDeviceMonitoringFlags(
  db: QueryExecutor,
  deviceId: string,
  input: { monitoringVisible?: boolean; enabled?: boolean },
): Promise<DeviceStateRecord | null> {
  const sets: string[] = [];
  const params: unknown[] = [deviceId];

  if (input.monitoringVisible !== undefined) {
    params.push(input.monitoringVisible);
    sets.push(`monitoring_visible = $${params.length}`);
  }
  if (input.enabled !== undefined) {
    params.push(input.enabled);
    sets.push(`enabled = $${params.length}`);
  }
  if (sets.length === 0) return getDeviceState(db, deviceId);

  const result = await db.query<DeviceStateRow>(
    `UPDATE device
     SET ${sets.join(", ")}, updated_at = now()
     WHERE id::text = $1
     RETURNING ${DEVICE_COLUMNS}`,
    params,
  );
  const row = result.rows[0];
  return row ? toDeviceState(row) : null;
}

export async function getDeviceHistory(
  db: QueryExecutor,
  idOrCode: string,
  limit = 20,
): Promise<DeviceHistory | null> {
  const device = await getDeviceState(db, idOrCode);
  if (!device) {
    return null;
  }

  const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const [commands, audits, alarms] = await Promise.all([
    db.query<DeviceCommandHistoryRow>(
      `SELECT command_id, session_id, command, status, mqtt_reason_code, created_at, updated_at
       FROM command
       WHERE target_type = 'DEVICE' AND target_id::text = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [device.id, normalizedLimit],
    ),
    db.query<DeviceAuditHistoryRow>(
      `SELECT log_id::text, ts, actor_type::text, actor_id, command, reason, execution_status,
              mqtt_reason_code, command_id
       FROM audit_log
       WHERE target_type = 'DEVICE' AND target_id = $1
       ORDER BY ts DESC
       LIMIT $2`,
      [device.id, normalizedLimit],
    ),
    db.query<DeviceAlarmHistoryRow>(
      `SELECT id::text, tier, severity, message, state, raised_at, snoozed_until, resolved_at
       FROM alarm_log
       WHERE device_id::text = $1
       ORDER BY raised_at DESC
       LIMIT $2`,
      [device.id, normalizedLimit],
    ),
  ]);

  return {
    device: {
      id: device.id,
      code: device.code,
      name: device.name,
      currentStatus: device.currentStatus,
    },
    commands: commands.rows.map(toCommandHistory),
    audits: audits.rows.map(toAuditHistory),
    alarms: alarms.rows.map(toAlarmHistory),
  };
}

// ─── Area slug path (mqtt_topic 생성용) ──────────────────────────────

export interface AreaSlugPath {
  siteSlug: string;
  buildingSlug: string;
  floorSlug: string;
  areaSlug: string;
}

/**
 * area→floor→building→site 4-way join으로 slug 4개를 반환.
 * buildDeviceBase()로 mqtt_topic을 생성할 때 사용한다(spatial-repository.ts의
 * getAreaById와 동일한 join).
 */
export async function getAreaSlugPath(
  db: QueryExecutor,
  areaId: string,
): Promise<AreaSlugPath | null> {
  const r = await db.query<QueryResultRow>(
    `SELECT s.slug AS site_slug, b.slug AS building_slug,
            f.slug AS floor_slug, a.slug AS area_slug
     FROM area a
     JOIN floor f     ON f.id = a.floor_id
     JOIN building b  ON b.id = f.building_id
     JOIN site s      ON s.id = b.site_id
     WHERE a.id::text = $1`,
    [areaId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    siteSlug: row.site_slug,
    buildingSlug: row.building_slug,
    floorSlug: row.floor_slug,
    areaSlug: row.area_slug,
  };
}

// ─── Device CRUD ─────────────────────────────────────────────────────

export interface CreateDeviceInput {
  code: string;
  name: string;
  category: DeviceCategory;
  deviceRole?: DeviceRole;
  deviceType?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  firmwareVersion?: string | null;
  mqttTopic: string;
  areaId: string;
  gatewayId?: string | null;
  parentDeviceId?: string | null;
  sensorSignalType?: SensorSignalType | null;
  sensorIoType?: SensorIoType | null;
  channelAddress?: string | null;
  terminalBlock?: string | null;
  loadClass?: LoadClass | null;
  description?: string | null;
}

/**
 * 기기 생성. mqtt_topic은 호출부에서 buildDeviceBase()로 생성해 전달한다(하드코딩 금지).
 * code/mqtt_topic UNIQUE 제약은 23505 에러로 발생하며, 서비스 레이어에서 처리한다.
 */
export async function createDevice(
  db: QueryExecutor,
  input: CreateDeviceInput,
): Promise<DeviceStateRecord> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO device (code, name, category, device_role, device_type, manufacturer, model,
        firmware_version, mqtt_topic, area_id, gateway_id, parent_device_id, sensor_signal_type,
        sensor_io_type, channel_address, terminal_block, load_class, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING id::text`,
    [
      input.code,
      input.name,
      input.category,
      input.deviceRole ?? "SENSOR",
      input.deviceType ?? null,
      input.manufacturer ?? null,
      input.model ?? null,
      input.firmwareVersion ?? null,
      input.mqttTopic,
      input.areaId,
      input.gatewayId ?? null,
      input.parentDeviceId ?? null,
      input.sensorSignalType ?? null,
      input.sensorIoType ?? null,
      input.channelAddress ?? null,
      input.terminalBlock ?? null,
      input.loadClass ?? "NORMAL",
      input.description ?? null,
    ],
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("device insert did not return an id");
  const created = await getDeviceState(db, id);
  if (!created) throw new Error("device insert did not return a row");
  return created;
}

export interface UpdateDeviceInput {
  name?: string | undefined;
  deviceType?: string | null | undefined;
  manufacturer?: string | null | undefined;
  model?: string | null | undefined;
  firmwareVersion?: string | null | undefined;
  gatewayId?: string | null | undefined;
  parentDeviceId?: string | null | undefined;
  sensorSignalType?: SensorSignalType | null | undefined;
  sensorIoType?: SensorIoType | null | undefined;
  channelAddress?: string | null | undefined;
  terminalBlock?: string | null | undefined;
  loadClass?: LoadClass | null | undefined;
  description?: string | null | undefined;
}

/**
 * 기기 기본 필드 수정. area/code/mqtt_topic은 불변(위치 이동은 폐기 후 재등록).
 * updateArea와 동일한 dynamic SET-list 패턴.
 */
export async function updateDevice(
  db: QueryExecutor,
  id: string,
  input: UpdateDeviceInput,
): Promise<DeviceStateRecord | null> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  if (input.name !== undefined) {
    params.push(input.name);
    sets.push(`name = $${params.length}`);
  }
  if (input.deviceType !== undefined) {
    params.push(input.deviceType);
    sets.push(`device_type = $${params.length}`);
  }
  if (input.manufacturer !== undefined) {
    params.push(input.manufacturer);
    sets.push(`manufacturer = $${params.length}`);
  }
  if (input.model !== undefined) {
    params.push(input.model);
    sets.push(`model = $${params.length}`);
  }
  if (input.firmwareVersion !== undefined) {
    params.push(input.firmwareVersion);
    sets.push(`firmware_version = $${params.length}`);
  }
  if (input.gatewayId !== undefined) {
    params.push(input.gatewayId);
    sets.push(`gateway_id = $${params.length}`);
  }
  if (input.parentDeviceId !== undefined) {
    params.push(input.parentDeviceId);
    sets.push(`parent_device_id = $${params.length}`);
  }
  if (input.sensorSignalType !== undefined) {
    params.push(input.sensorSignalType);
    sets.push(`sensor_signal_type = $${params.length}`);
  }
  if (input.sensorIoType !== undefined) {
    params.push(input.sensorIoType);
    sets.push(`sensor_io_type = $${params.length}`);
  }
  if (input.channelAddress !== undefined) {
    params.push(input.channelAddress);
    sets.push(`channel_address = $${params.length}`);
  }
  if (input.terminalBlock !== undefined) {
    params.push(input.terminalBlock);
    sets.push(`terminal_block = $${params.length}`);
  }
  if (input.loadClass !== undefined) {
    params.push(input.loadClass);
    sets.push(`load_class = $${params.length}`);
  }
  if (input.description !== undefined) {
    params.push(input.description);
    sets.push(`description = $${params.length}`);
  }
  if (sets.length === 0) return getDeviceState(db, id);

  await db.query(`UPDATE device SET ${sets.join(", ")}, updated_at = now() WHERE id::text = $1`, params);
  return getDeviceState(db, id);
}

/**
 * 기기 폐기(소프트 전이). lifecycle_status → DECOMMISSIONED.
 * 하드 DELETE 대신 감사 이력(telemetry/command/audit) 보존(설계 결정).
 */
export async function decommissionDevice(
  db: QueryExecutor,
  id: string,
): Promise<DeviceStateRecord | null> {
  const r = await db.query<DeviceStateRow>(
    `UPDATE device SET lifecycle_status = 'DECOMMISSIONED', updated_at = now()
     WHERE id::text = $1
     RETURNING ${DEVICE_COLUMNS}`,
    [id],
  );
  const row = r.rows[0];
  return row ? toDeviceState(row) : null;
}
