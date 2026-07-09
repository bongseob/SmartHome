import type { DeviceStatus } from "@smarthome/contracts";
import { query } from "./pool.js";

/**
 * 얇은 repository (ORM 미사용). 파라미터라이즈드 쿼리만 사용(SQL 인젝션 차단).
 * gateway 인제스트가 사용하는 최소 집합.
 */

export async function getDeviceIdByCode(code: string): Promise<string | null> {
  const r = await query<{ id: string }>("SELECT id FROM device WHERE code = $1", [code]);
  return r.rows[0]?.id ?? null;
}

export async function setDeviceStatus(code: string, status: DeviceStatus): Promise<void> {
  await query("UPDATE device SET current_status = $1, updated_at = now() WHERE code = $2", [
    status,
    code,
  ]);
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
