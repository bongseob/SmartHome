import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";

// ─── System Setting (docs/srs-lighting-control-addendum.md §1·§4·§5) ──────
// 운영 설정 key/value. 하드코딩 금지 원칙에 따라 순차 제어 간격·엔드포인트 등을 여기서 읽는다.

export const SEQUENTIAL_INTERVAL_KEY = "control.sequential_interval_ms";
export const DEFAULT_SEQUENTIAL_INTERVAL_MS = 1500;
export const SYSTEM_NAME_KEY = "system.name";
export const DEFAULT_SYSTEM_NAME = "SmartHome 관제";

export async function getSystemSetting(
  db: QueryExecutor,
  key: string,
): Promise<unknown | null> {
  const r = await db.query<QueryResultRow & { value: unknown }>(
    `SELECT value FROM system_setting WHERE key = $1`,
    [key],
  );
  const row = r.rows[0];
  return row ? row.value : null;
}

/** 그룹 일괄 제어의 순차 발행 간격(ms). 설정이 없거나 부적절하면 기본 1500ms(addendum §5). */
export async function getSequentialIntervalMs(db: QueryExecutor): Promise<number> {
  const value = await getSystemSetting(db, SEQUENTIAL_INTERVAL_KEY);
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_SEQUENTIAL_INTERVAL_MS;
}

/** 로그인 화면 등 인증 전에도 필요한 시스템 표시 이름 — 값이 없거나 비어있으면 기본값. */
export async function getSystemName(db: QueryExecutor): Promise<string> {
  const value = await getSystemSetting(db, SYSTEM_NAME_KEY);
  return typeof value === "string" && value.trim() ? value : DEFAULT_SYSTEM_NAME;
}

// ─── 관리자용 system_setting 조회/수정(2026-07-15) ─────────────────────────
// 마이그레이션으로 미리 시딩된 key만 값을 바꿀 수 있다 — UI가 새 key를 임의로 만들어내지 않는다.

export interface SystemSettingRecord {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: string;
}

interface SystemSettingRow extends QueryResultRow {
  key: string;
  value: unknown;
  description: string | null;
  updated_at: string;
}

function toSystemSetting(row: SystemSettingRow): SystemSettingRecord {
  return { key: row.key, value: row.value, description: row.description, updatedAt: row.updated_at };
}

export async function listSystemSettings(db: QueryExecutor): Promise<SystemSettingRecord[]> {
  const r = await db.query<SystemSettingRow>(
    `SELECT key, value, description, updated_at FROM system_setting ORDER BY key`,
  );
  return r.rows.map(toSystemSetting);
}

export async function updateSystemSetting(
  db: QueryExecutor,
  key: string,
  value: unknown,
  updatedBy: string | null,
): Promise<SystemSettingRecord | null> {
  const r = await db.query<SystemSettingRow>(
    `UPDATE system_setting SET value = $2, updated_by = $3, updated_at = now()
     WHERE key = $1
     RETURNING key, value, description, updated_at`,
    [key, JSON.stringify(value), updatedBy],
  );
  const row = r.rows[0];
  return row ? toSystemSetting(row) : null;
}
