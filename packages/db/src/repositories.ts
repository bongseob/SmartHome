import type { ActorType, DeviceStatus, ExecutionStatus } from "@smarthome/contracts";
import type { QueryResultRow } from "./pool.js";
import { query } from "./pool.js";

/**
 * 얇은 repository (ORM 미사용). 파라미터라이즈드 쿼리만 사용(SQL 인젝션 차단).
 * gateway 인제스트가 사용하는 최소 집합.
 */

export async function getDeviceIdByCode(code: string): Promise<string | null> {
  const r = await query<{ id: string }>("SELECT id FROM device WHERE code = $1", [code]);
  return r.rows[0]?.id ?? null;
}

export interface DeviceStatusUpdateResult {
  deviceId: string | null;
  previousStatus: DeviceStatus | null;
  currentStatus: DeviceStatus | null;
  changed: boolean;
}

interface DeviceStatusUpdateRow extends QueryResultRow {
  device_id: string | null;
  previous_status: DeviceStatus | null;
  current_status: DeviceStatus | null;
  changed: boolean;
}

export async function setDeviceStatus(
  code: string,
  status: DeviceStatus,
): Promise<DeviceStatusUpdateResult> {
  const r = await query<DeviceStatusUpdateRow>(
    `WITH before AS (
       SELECT id::text, current_status
       FROM device
       WHERE code = $2
     ),
     updated AS (
       UPDATE device
       SET current_status = $1, updated_at = now()
       WHERE code = $2
         AND current_status IS DISTINCT FROM $1
       RETURNING id::text, current_status
     )
     SELECT
       before.id AS device_id,
       before.current_status AS previous_status,
       COALESCE(updated.current_status, before.current_status) AS current_status,
       (updated.id IS NOT NULL) AS changed
     FROM before
     LEFT JOIN updated ON true`,
    [status, code],
  );
  const row = r.rows[0];
  return {
    deviceId: row?.device_id ?? null,
    previousStatus: row?.previous_status ?? null,
    currentStatus: row?.current_status ?? null,
    changed: row?.changed ?? false,
  };
}

export interface CascadedOfflineChild {
  deviceId: string;
  code: string;
  previousStatus: DeviceStatus;
}

interface CascadedOfflineChildRow extends QueryResultRow {
  id: string;
  code: string;
  previous_status: DeviceStatus;
}

/**
 * 감시장비(보드)가 OFFLINE으로 전이될 때, 거기 딸린 채널(parent_device_id)들도 함께
 * OFFLINE 처리한다 — 보드 연결이 끊기면 개별 채널은 자기 상태를 더 이상 갱신할 수
 * 없으므로(같은 물리 연결을 공유), 화면에 마지막 값이 그대로 남는 걸 막는다.
 */
export async function cascadeChildrenOffline(parentDeviceId: string): Promise<CascadedOfflineChild[]> {
  const r = await query<CascadedOfflineChildRow>(
    `WITH before AS (
       SELECT id::text, code, current_status
       FROM device
       WHERE parent_device_id = $1
         AND current_status IS DISTINCT FROM 'OFFLINE'
     ),
     updated AS (
       UPDATE device
       SET current_status = 'OFFLINE', updated_at = now()
       WHERE id::text IN (SELECT id FROM before)
       RETURNING id::text
     )
     SELECT before.id, before.code, before.current_status AS previous_status
     FROM before
     JOIN updated ON updated.id = before.id`,
    [parentDeviceId],
  );
  return r.rows.map((row) => ({
    deviceId: row.id,
    code: row.code,
    previousStatus: row.previous_status,
  }));
}

export interface IntentionalStateCommand {
  commandId: string;
  command: string;
  actorType: ActorType;
  status: ExecutionStatus;
}

interface IntentionalStateCommandRow extends QueryResultRow {
  command_id: string;
  command: string;
  actor_type: ActorType;
  status: ExecutionStatus;
}

function commandsForStatus(status: DeviceStatus): string[] {
  if (status === "ON") return ["turn_on", "on"];
  if (status === "OFF") return ["turn_off", "off"];
  return [];
}

export async function findRecentIntentionalStateCommand(
  deviceId: string,
  status: DeviceStatus,
  windowMs: number,
): Promise<IntentionalStateCommand | null> {
  const commands = commandsForStatus(status);
  if (commands.length === 0) return null;
  const r = await query<IntentionalStateCommandRow>(
    `SELECT command_id, command, actor_type, status
     FROM command
     WHERE target_type = 'DEVICE'
       AND target_id::text = $1
       AND command = ANY($2::text[])
       AND status IN ('PENDING', 'IN_PROGRESS', 'SUCCEEDED')
       AND updated_at >= now() - ($3::int * interval '1 millisecond')
     ORDER BY updated_at DESC
     LIMIT 1`,
    [deviceId, commands, Math.trunc(windowMs)],
  );
  const row = r.rows[0];
  return row
    ? {
        commandId: row.command_id,
        command: row.command,
        actorType: row.actor_type,
        status: row.status,
      }
    : null;
}

export interface TelemetryRow {
  time: Date;
  deviceId: string;
  metric: string;
  valueNum: number | null;
  valueText: string | null;
}

/** 다중 행 배치 insert (성능: gateway가 짧은 주기로 flush) */
export async function insertTelemetryBatch(rows: TelemetryRow[]): Promise<void> {
  if (rows.length === 0) return;
  const values: unknown[] = [];
  const tuples = rows.map((r, i) => {
    const b = i * 5;
    values.push(r.time, r.deviceId, r.metric, r.valueNum, r.valueText);
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`;
  });
  await query(
    `INSERT INTO telemetry ("time", device_id, metric, value_num, value_text) VALUES ${tuples.join(",")}`,
    values,
  );
}

/** LWT/Offline 감지 시 알람 기록 (docs/erd.md E, SRS 4.3.1) */
export async function raiseOfflineAlarm(deviceId: string, message: string): Promise<void> {
  await query(
    `INSERT INTO alarm_log (device_id, tier, severity, message, state)
     VALUES ($1, 'REACTIVE', 'WARNING', $2, 'RAISED')`,
    [deviceId, message],
  );
}

export async function raiseUnexpectedStateChangeAlarm(
  deviceId: string,
  message: string,
  severity: "WARNING" | "CRITICAL" = "WARNING",
): Promise<boolean> {
  const r = await query<{ id: string }>(
    `INSERT INTO alarm_log (device_id, tier, severity, message, state)
     SELECT $1, 'REACTIVE', $3::severity, $2, 'RAISED'
     WHERE NOT EXISTS (
       SELECT 1
       FROM alarm_log
       WHERE device_id = $1
         AND state IN ('RAISED', 'ACK', 'SNOOZED')
         AND message = $2
     )
     RETURNING id::text`,
    [deviceId, message, severity],
  );
  return r.rows.length > 0;
}
