import type { QueryExecutor } from "./audit-repository.js";
import type { QueryResultRow } from "./pool.js";

export interface GroupControlSummary {
  id: string;
  slug: string;
  name: string;
  isDynamic: boolean;
  totalCount: number;
  onCount: number;
  offCount: number;
  unknownCount: number;
}

interface GroupControlSummaryRow extends QueryResultRow {
  id: string;
  slug: string;
  name: string;
  is_dynamic: boolean;
  total_count: string;
  on_count: string;
  off_count: string;
  unknown_count: string;
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return value;
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toGroupControlSummary(row: GroupControlSummaryRow): GroupControlSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    isDynamic: row.is_dynamic,
    totalCount: toNumber(row.total_count),
    onCount: toNumber(row.on_count),
    offCount: toNumber(row.off_count),
    unknownCount: toNumber(row.unknown_count),
  };
}

/**
 * 그룹 제어 화면용 요약.
 * 감시장비(RMU)는 제어 대상 센서 집계에서 제외하고, 모니터링에서 숨김/미사용/폐기된 센서도 제외한다.
 */
export async function listGroupControlSummaries(
  db: QueryExecutor,
): Promise<GroupControlSummary[]> {
  const r = await db.query<GroupControlSummaryRow>(
    `SELECT
       g.id::text,
       g.slug,
       g.name,
       g.is_dynamic,
       COUNT(d.id) FILTER (
         WHERE d.device_role = 'SENSOR'
           AND d.monitoring_visible = true
           AND d.enabled = true
           AND d.lifecycle_status <> 'DECOMMISSIONED'
       ) AS total_count,
       COUNT(d.id) FILTER (
         WHERE d.device_role = 'SENSOR'
           AND d.monitoring_visible = true
           AND d.enabled = true
           AND d.lifecycle_status <> 'DECOMMISSIONED'
           AND d.current_status = 'ON'
       ) AS on_count,
       COUNT(d.id) FILTER (
         WHERE d.device_role = 'SENSOR'
           AND d.monitoring_visible = true
           AND d.enabled = true
           AND d.lifecycle_status <> 'DECOMMISSIONED'
           AND d.current_status = 'OFF'
       ) AS off_count,
       COUNT(d.id) FILTER (
         WHERE d.device_role = 'SENSOR'
           AND d.monitoring_visible = true
           AND d.enabled = true
           AND d.lifecycle_status <> 'DECOMMISSIONED'
           AND d.current_status NOT IN ('ON', 'OFF')
       ) AS unknown_count
     FROM device_group g
     LEFT JOIN device_group_mapping gm ON gm.group_id = g.id
     LEFT JOIN device d ON d.id = gm.device_id
     GROUP BY g.id, g.slug, g.name, g.is_dynamic
     ORDER BY g.name`,
  );
  return r.rows.map(toGroupControlSummary);
}
