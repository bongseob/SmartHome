import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";

// ─── System Setting (docs/srs-lighting-control-addendum.md §1·§4·§5) ──────
// 운영 설정 key/value. 하드코딩 금지 원칙에 따라 순차 제어 간격·엔드포인트 등을 여기서 읽는다.

export const SEQUENTIAL_INTERVAL_KEY = "control.sequential_interval_ms";
export const DEFAULT_SEQUENTIAL_INTERVAL_MS = 1500;

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
