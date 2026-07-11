import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";

// ─── Time Program (docs/srs-lighting-control-addendum.md §6.2·§6.3) ────────
// 정기 운영 스케줄 템플릿(최대 300). 요일별(0=일~6=토)/공휴일 슬롯 + Device_Group N:M 매핑.

export interface TimeProgramRecord {
  id: string;
  programNo: number;
  name: string;
  enabled: boolean;
  createdAt: Date;
}

interface TimeProgramRow extends QueryResultRow {
  id: string;
  program_no: number;
  name: string;
  enabled: boolean;
  created_at: Date;
}

function toTimeProgram(row: TimeProgramRow): TimeProgramRecord {
  return {
    id: row.id,
    programNo: row.program_no,
    name: row.name,
    enabled: row.enabled,
    createdAt: row.created_at,
  };
}

const TP_COLUMNS = `id::text, program_no, name, enabled, created_at`;

export interface CreateTimeProgramInput {
  programNo: number;
  name: string;
  createdBy?: string | null;
}

export async function createTimeProgram(
  db: QueryExecutor,
  input: CreateTimeProgramInput,
): Promise<TimeProgramRecord> {
  const r = await db.query<TimeProgramRow>(
    `INSERT INTO time_program (program_no, name, created_by)
     VALUES ($1,$2,$3)
     RETURNING ${TP_COLUMNS}`,
    [input.programNo, input.name, input.createdBy ?? null],
  );
  const row = r.rows[0];
  if (!row) throw new Error("time_program insert did not return a row");
  return toTimeProgram(row);
}

export async function listTimePrograms(db: QueryExecutor): Promise<TimeProgramRecord[]> {
  const r = await db.query<TimeProgramRow>(
    `SELECT ${TP_COLUMNS} FROM time_program ORDER BY program_no`,
  );
  return r.rows.map(toTimeProgram);
}

export async function getTimeProgramById(
  db: QueryExecutor,
  id: string,
): Promise<TimeProgramRecord | null> {
  const r = await db.query<TimeProgramRow>(
    `SELECT ${TP_COLUMNS} FROM time_program WHERE id::text = $1`,
    [id],
  );
  const row = r.rows[0];
  return row ? toTimeProgram(row) : null;
}

export async function setTimeProgramEnabled(
  db: QueryExecutor,
  id: string,
  enabled: boolean,
): Promise<TimeProgramRecord | null> {
  const r = await db.query<TimeProgramRow>(
    `UPDATE time_program SET enabled = $2 WHERE id::text = $1 RETURNING ${TP_COLUMNS}`,
    [id, enabled],
  );
  const row = r.rows[0];
  return row ? toTimeProgram(row) : null;
}

export async function deleteTimeProgram(db: QueryExecutor, id: string): Promise<boolean> {
  const r = await db.query(`DELETE FROM time_program WHERE id::text = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}

// ─── Slots ────────────────────────────────────────────────────────────────

export interface TimeProgramSlotRecord {
  id: string;
  timeProgramId: string;
  dayOfWeek: number | null;
  isHoliday: boolean;
  atTime: string;
  powerOn: boolean;
}

interface TimeProgramSlotRow extends QueryResultRow {
  id: string;
  time_program_id: string;
  day_of_week: number | null;
  is_holiday: boolean;
  at_time: string;
  power_on: boolean;
}

function toSlot(row: TimeProgramSlotRow): TimeProgramSlotRecord {
  return {
    id: row.id,
    timeProgramId: row.time_program_id,
    dayOfWeek: row.day_of_week,
    isHoliday: row.is_holiday,
    atTime: row.at_time,
    powerOn: row.power_on,
  };
}

const SLOT_COLUMNS = `id::text, time_program_id::text, day_of_week, is_holiday, at_time::text, power_on`;

export interface AddSlotInput {
  timeProgramId: string;
  dayOfWeek: number | null;
  isHoliday: boolean;
  atTime: string;
  powerOn: boolean;
}

export async function addTimeProgramSlot(
  db: QueryExecutor,
  input: AddSlotInput,
): Promise<TimeProgramSlotRecord> {
  const r = await db.query<TimeProgramSlotRow>(
    `INSERT INTO time_program_slot (time_program_id, day_of_week, is_holiday, at_time, power_on)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING ${SLOT_COLUMNS}`,
    [input.timeProgramId, input.dayOfWeek, input.isHoliday, input.atTime, input.powerOn],
  );
  const row = r.rows[0];
  if (!row) throw new Error("time_program_slot insert did not return a row");
  return toSlot(row);
}

export async function listTimeProgramSlots(
  db: QueryExecutor,
  timeProgramId: string,
): Promise<TimeProgramSlotRecord[]> {
  const r = await db.query<TimeProgramSlotRow>(
    `SELECT ${SLOT_COLUMNS} FROM time_program_slot
     WHERE time_program_id::text = $1
     ORDER BY is_holiday, day_of_week NULLS LAST, at_time`,
    [timeProgramId],
  );
  return r.rows.map(toSlot);
}

/** slotId가 해당 program 소속일 때만 삭제(경로 일관성). */
export async function deleteTimeProgramSlot(
  db: QueryExecutor,
  timeProgramId: string,
  slotId: string,
): Promise<boolean> {
  const r = await db.query(
    `DELETE FROM time_program_slot WHERE id::text = $1 AND time_program_id::text = $2`,
    [slotId, timeProgramId],
  );
  return (r.rowCount ?? 0) > 0;
}

// ─── Group mapping (스케줄 등록: 프로그램 ↔ Device_Group N:M) ────────────

export interface TimeProgramGroupRecord {
  groupId: string;
  groupName: string;
}

export async function mapTimeProgramGroup(
  db: QueryExecutor,
  timeProgramId: string,
  groupId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO time_program_group (time_program_id, group_id) VALUES ($1,$2)`,
    [timeProgramId, groupId],
  );
}

export async function unmapTimeProgramGroup(
  db: QueryExecutor,
  timeProgramId: string,
  groupId: string,
): Promise<boolean> {
  const r = await db.query(
    `DELETE FROM time_program_group WHERE time_program_id::text = $1 AND group_id::text = $2`,
    [timeProgramId, groupId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function listTimeProgramGroups(
  db: QueryExecutor,
  timeProgramId: string,
): Promise<TimeProgramGroupRecord[]> {
  const r = await db.query<{ group_id: string; group_name: string }>(
    `SELECT g.id::text AS group_id, g.name AS group_name
       FROM time_program_group m
       JOIN device_group g ON g.id = m.group_id
      WHERE m.time_program_id::text = $1
      ORDER BY g.name`,
    [timeProgramId],
  );
  return r.rows.map((row) => ({ groupId: row.group_id, groupName: row.group_name }));
}
