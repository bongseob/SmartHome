import type { ScheduleRunStatus, ScheduleType, TargetType } from "@smarthome/contracts";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";

// ─── Scheduler ───────────────────────────────────────────────────────────

export interface SchedulerRecord {
  id: string;
  name: string;
  targetType: TargetType;
  targetId: string;
  scheduleType: ScheduleType;
  runAt: Date | null;
  cronExpr: string | null;
  daysOfWeek: number[] | null;
  dayOfMonth: number | null;
  eventTrigger: unknown;
  payload: unknown;
  enabled: boolean;
}

interface SchedulerRow extends QueryResultRow {
  id: string;
  name: string;
  target_type: TargetType;
  target_id: string;
  schedule_type: ScheduleType;
  run_at: Date | null;
  cron_expr: string | null;
  days_of_week: number[] | null;
  day_of_month: number | null;
  event_trigger: unknown;
  payload: unknown;
  enabled: boolean;
}

function toScheduler(row: SchedulerRow): SchedulerRecord {
  return {
    id: row.id,
    name: row.name,
    targetType: row.target_type,
    targetId: row.target_id,
    scheduleType: row.schedule_type,
    runAt: row.run_at,
    cronExpr: row.cron_expr,
    daysOfWeek: row.days_of_week,
    dayOfMonth: row.day_of_month,
    eventTrigger: row.event_trigger,
    payload: row.payload,
    enabled: row.enabled,
  };
}

const SCHEDULER_COLUMNS = `
  id::text, name, target_type, target_id::text, schedule_type, run_at, cron_expr,
  days_of_week, day_of_month, event_trigger, payload, enabled
`;

export interface CreateSchedulerInput {
  name: string;
  targetType: TargetType;
  targetId: string;
  scheduleType: ScheduleType;
  runAt?: Date | null;
  cronExpr?: string | null;
  daysOfWeek?: number[] | null;
  dayOfMonth?: number | null;
  eventTrigger?: unknown;
  payload: Record<string, unknown>;
  createdBy?: string | null;
}

export async function createScheduler(
  db: QueryExecutor,
  input: CreateSchedulerInput,
): Promise<SchedulerRecord> {
  const r = await db.query<SchedulerRow>(
    `INSERT INTO scheduler (
       name, target_type, target_id, schedule_type, run_at, cron_expr,
       days_of_week, day_of_month, event_trigger, payload, created_by
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING ${SCHEDULER_COLUMNS}`,
    [
      input.name,
      input.targetType,
      input.targetId,
      input.scheduleType,
      input.runAt ?? null,
      input.cronExpr ?? null,
      input.daysOfWeek ?? null,
      input.dayOfMonth ?? null,
      input.eventTrigger ? JSON.stringify(input.eventTrigger) : null,
      JSON.stringify(input.payload),
      input.createdBy ?? null,
    ],
  );
  const row = r.rows[0];
  if (!row) throw new Error("scheduler insert did not return a row");
  return toScheduler(row);
}

export async function listSchedulers(
  db: QueryExecutor,
  filter: { enabled?: boolean } = {},
): Promise<SchedulerRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.enabled !== undefined) {
    params.push(filter.enabled);
    conditions.push(`enabled = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const r = await db.query<SchedulerRow>(
    `SELECT ${SCHEDULER_COLUMNS} FROM scheduler ${where} ORDER BY name`,
    params,
  );
  return r.rows.map(toScheduler);
}

export async function getSchedulerById(db: QueryExecutor, id: string): Promise<SchedulerRecord | null> {
  const r = await db.query<SchedulerRow>(`SELECT ${SCHEDULER_COLUMNS} FROM scheduler WHERE id::text = $1`, [id]);
  const row = r.rows[0];
  return row ? toScheduler(row) : null;
}

/** 스케줄러 폴링 전용 — 다중 인스턴스 동시 처리 방지(SKIP LOCKED로 락 걸린 row는 건너뛴다). */
export async function lockSchedulerById(db: QueryExecutor, id: string): Promise<SchedulerRecord | null> {
  const r = await db.query<SchedulerRow>(
    `SELECT ${SCHEDULER_COLUMNS} FROM scheduler WHERE id::text = $1 FOR UPDATE SKIP LOCKED`,
    [id],
  );
  const row = r.rows[0];
  return row ? toScheduler(row) : null;
}

export async function setSchedulerEnabled(
  db: QueryExecutor,
  id: string,
  enabled: boolean,
): Promise<SchedulerRecord | null> {
  const r = await db.query<SchedulerRow>(
    `UPDATE scheduler SET enabled = $2 WHERE id::text = $1 RETURNING ${SCHEDULER_COLUMNS}`,
    [id, enabled],
  );
  const row = r.rows[0];
  return row ? toScheduler(row) : null;
}

export async function deleteScheduler(db: QueryExecutor, id: string): Promise<boolean> {
  const r = await db.query(`DELETE FROM scheduler WHERE id::text = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}

// ─── Schedule Run ────────────────────────────────────────────────────────

export interface ScheduleRunRecord {
  id: string;
  schedulerId: string;
  firedAt: Date;
  commandId: string | null;
  status: ScheduleRunStatus;
}

interface ScheduleRunRow extends QueryResultRow {
  id: string;
  scheduler_id: string;
  fired_at: Date;
  command_id: string | null;
  status: ScheduleRunStatus;
}

function toScheduleRun(row: ScheduleRunRow): ScheduleRunRecord {
  return {
    id: row.id,
    schedulerId: row.scheduler_id,
    firedAt: row.fired_at,
    commandId: row.command_id,
    status: row.status,
  };
}

const SCHEDULE_RUN_COLUMNS = `id::text, scheduler_id::text, fired_at, command_id, status`;

export async function insertScheduleRun(
  db: QueryExecutor,
  input: { schedulerId: string; commandId: string | null; status: ScheduleRunStatus },
): Promise<ScheduleRunRecord> {
  const r = await db.query<ScheduleRunRow>(
    `INSERT INTO schedule_run (scheduler_id, command_id, status)
     VALUES ($1,$2,$3)
     RETURNING ${SCHEDULE_RUN_COLUMNS}`,
    [input.schedulerId, input.commandId, input.status],
  );
  const row = r.rows[0];
  if (!row) throw new Error("schedule_run insert did not return a row");
  return toScheduleRun(row);
}

export async function updateScheduleRunStatus(
  db: QueryExecutor,
  id: string,
  status: ScheduleRunStatus,
): Promise<void> {
  await db.query(`UPDATE schedule_run SET status = $2 WHERE id::text = $1`, [id, status]);
}

/**
 * command_id는 command(command_id) FK라 command row가 실제로 존재해야 채울 수 있다.
 * claim 시점엔 아직 command가 없으므로 command_id=null로 먼저 만들고, 발행 성공 후 이걸로 채운다.
 */
export async function updateScheduleRunCommandId(
  db: QueryExecutor,
  id: string,
  commandId: string,
): Promise<void> {
  await db.query(`UPDATE schedule_run SET command_id = $2 WHERE id::text = $1`, [id, commandId]);
}

/** 해당 scheduler의 가장 최근 schedule_run(성공/실패/스킵 무관) — due 판정에 사용. */
export async function getLastRunForScheduler(
  db: QueryExecutor,
  schedulerId: string,
): Promise<ScheduleRunRecord | null> {
  const r = await db.query<ScheduleRunRow>(
    `SELECT ${SCHEDULE_RUN_COLUMNS} FROM schedule_run
     WHERE scheduler_id::text = $1
     ORDER BY fired_at DESC LIMIT 1`,
    [schedulerId],
  );
  const row = r.rows[0];
  return row ? toScheduleRun(row) : null;
}

export async function listRunsForScheduler(
  db: QueryExecutor,
  schedulerId: string,
  limit = 20,
): Promise<ScheduleRunRecord[]> {
  const r = await db.query<ScheduleRunRow>(
    `SELECT ${SCHEDULE_RUN_COLUMNS} FROM schedule_run
     WHERE scheduler_id::text = $1
     ORDER BY fired_at DESC LIMIT $2`,
    [schedulerId, limit],
  );
  return r.rows.map(toScheduleRun);
}

// ─── Device Group membership (스케줄러 GROUP 타깃 fan-out용) ────────────

export async function listGroupDeviceIds(db: QueryExecutor, groupId: string): Promise<string[]> {
  const r = await db.query<{ device_id: string }>(
    `SELECT device_id::text FROM device_group_mapping WHERE group_id::text = $1`,
    [groupId],
  );
  return r.rows.map((row) => row.device_id);
}
