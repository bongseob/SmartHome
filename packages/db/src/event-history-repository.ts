import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";

// ─── 장애이력 (docs/srs-lighting-control-addendum.md §8) ──────────────────
// 새 저장소 없이 기존 3계층 로그 위의 통합 조회 뷰.
//   알림(INFO)  = 제어에 의한 ON/OFF → audit_log (target_type DEVICE/GROUP)
//   경고(WARNING) = 알람에 의한 ON/OFF → alarm_log
//   전체(ALL)   = 둘의 합집합
// 등급·기간(from~to)으로 필터. 읽기 전용이라 audit_log에 기록하지 않는다.

export type EventGrade = "INFO" | "WARNING";

export interface EventHistoryRecord {
  source: "AUDIT" | "ALARM";
  grade: EventGrade;
  time: Date;
  targetType: string | null;
  targetId: string | null;
  label: string | null;
  detail: string | null;
  status: string | null;
}

interface EventRow extends QueryResultRow {
  source: "AUDIT" | "ALARM";
  grade: EventGrade;
  time: Date;
  target_type: string | null;
  target_id: string | null;
  label: string | null;
  detail: string | null;
  status: string | null;
}

function toEvent(row: EventRow): EventHistoryRecord {
  return {
    source: row.source,
    grade: row.grade,
    time: row.time,
    targetType: row.target_type,
    targetId: row.target_id,
    label: row.label,
    detail: row.detail,
    status: row.status,
  };
}

export interface EventHistoryFilter {
  from?: Date | null;
  to?: Date | null;
  includeInfo: boolean;
  includeWarning: boolean;
  limit?: number;
}

export async function listEventHistory(
  db: QueryExecutor,
  filter: EventHistoryFilter,
): Promise<EventHistoryRecord[]> {
  const from = filter.from ?? null;
  const to = filter.to ?? null;
  const limit = filter.limit ?? 200;
  const r = await db.query<EventRow>(
    `SELECT source, grade, time, target_type, target_id, label, detail, status
     FROM (
       -- 알림: 제어(audit_log). 기기/그룹 제어 이력만(관리 행위 제외).
       SELECT 'AUDIT'::text AS source, 'INFO'::text AS grade, ts AS time,
              target_type, target_id, command AS label, reason AS detail,
              execution_status::text AS status
       FROM audit_log
       WHERE $3::boolean
         AND target_type IN ('DEVICE','GROUP')
         AND ($1::timestamptz IS NULL OR ts >= $1)
         AND ($2::timestamptz IS NULL OR ts <= $2)
       UNION ALL
       -- 경고: 알람(alarm_log).
       SELECT 'ALARM'::text, 'WARNING'::text, raised_at,
              'DEVICE'::text, device_id::text,
              (tier::text || '/' || state::text) AS label, message AS detail,
              severity::text AS status
       FROM alarm_log
       WHERE $4::boolean
         AND ($1::timestamptz IS NULL OR raised_at >= $1)
         AND ($2::timestamptz IS NULL OR raised_at <= $2)
     ) e
     ORDER BY time DESC
     LIMIT $5`,
    [from, to, filter.includeInfo, filter.includeWarning, limit],
  );
  return r.rows.map(toEvent);
}
