import type { LunarSolar } from "@smarthome/contracts";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";

// ─── Holiday (docs/srs-lighting-control-addendum.md §7) ───────────────────
// 타임프로그램의 공휴일 스케줄 판정에 사용. 음력(설날·추석)은 lunar_solar='LUNAR'로 등록하고
// 스케줄 판정 시 해당 연도 양력으로 변환한다. 연휴는 날짜별로 각각 등록.

export interface HolidayRecord {
  id: string;
  month: number;
  day: number;
  lunarSolar: LunarSolar;
  name: string;
  createdAt: Date;
}

interface HolidayRow extends QueryResultRow {
  id: string;
  month: number;
  day: number;
  lunar_solar: LunarSolar;
  name: string;
  created_at: Date;
}

function toHoliday(row: HolidayRow): HolidayRecord {
  return {
    id: row.id,
    month: row.month,
    day: row.day,
    lunarSolar: row.lunar_solar,
    name: row.name,
    createdAt: row.created_at,
  };
}

const HOLIDAY_COLUMNS = `id::text, month, day, lunar_solar, name, created_at`;

export interface CreateHolidayInput {
  month: number;
  day: number;
  lunarSolar: LunarSolar;
  name: string;
}

export async function createHoliday(
  db: QueryExecutor,
  input: CreateHolidayInput,
): Promise<HolidayRecord> {
  const r = await db.query<HolidayRow>(
    `INSERT INTO holiday (month, day, lunar_solar, name)
     VALUES ($1,$2,$3,$4)
     RETURNING ${HOLIDAY_COLUMNS}`,
    [input.month, input.day, input.lunarSolar, input.name],
  );
  const row = r.rows[0];
  if (!row) throw new Error("holiday insert did not return a row");
  return toHoliday(row);
}

export async function listHolidays(
  db: QueryExecutor,
  filter: { lunarSolar?: LunarSolar } = {},
): Promise<HolidayRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.lunarSolar !== undefined) {
    params.push(filter.lunarSolar);
    conditions.push(`lunar_solar = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const r = await db.query<HolidayRow>(
    `SELECT ${HOLIDAY_COLUMNS} FROM holiday ${where} ORDER BY month, day`,
    params,
  );
  return r.rows.map(toHoliday);
}

export async function getHolidayById(
  db: QueryExecutor,
  id: string,
): Promise<HolidayRecord | null> {
  const r = await db.query<HolidayRow>(
    `SELECT ${HOLIDAY_COLUMNS} FROM holiday WHERE id::text = $1`,
    [id],
  );
  const row = r.rows[0];
  return row ? toHoliday(row) : null;
}

export interface UpdateHolidayInput {
  month: number;
  day: number;
  lunarSolar: LunarSolar;
  name: string;
}

export async function updateHoliday(
  db: QueryExecutor,
  id: string,
  input: UpdateHolidayInput,
): Promise<HolidayRecord | null> {
  const r = await db.query<HolidayRow>(
    `UPDATE holiday SET month = $2, day = $3, lunar_solar = $4, name = $5
     WHERE id::text = $1
     RETURNING ${HOLIDAY_COLUMNS}`,
    [id, input.month, input.day, input.lunarSolar, input.name],
  );
  const row = r.rows[0];
  return row ? toHoliday(row) : null;
}

export async function deleteHoliday(db: QueryExecutor, id: string): Promise<boolean> {
  const r = await db.query(`DELETE FROM holiday WHERE id::text = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}
