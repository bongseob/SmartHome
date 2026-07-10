import type {
  AlarmState,
  AlarmTier,
  DeviceCategory,
  DeviceConnectionProtocol,
  DeviceLifecycle,
  DeviceStatus,
  ExecutionStatus,
  Severity,
} from "@smarthome/contracts";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";

export interface DeviceStateRecord {
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
  device_type: string | null;
  manufacturer: string | null;
  model: string | null;
  firmware_version: string | null;
  mqtt_topic: string;
  current_status: DeviceStatus;
  lifecycle_status: DeviceLifecycle;
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
  id::text, code, name, category, device_type, manufacturer, model, firmware_version,
  mqtt_topic, current_status, lifecycle_status, area_id::text, pos_x::text, pos_y::text,
  gateway_id::text, connection_protocol, connection_config, updated_at
`;

function toDeviceState(row: DeviceStateRow): DeviceStateRecord {
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
