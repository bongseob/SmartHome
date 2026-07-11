import { describe, expect, it } from "vitest";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";
import {
  createHoliday,
  deleteHoliday,
  listHolidays,
  updateHoliday,
} from "./holiday-repository.js";

class FakeHolidayDb implements QueryExecutor {
  readonly statements: string[] = [];
  constructor(private row: Record<string, unknown> | null = null) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    this.statements.push(text);

    if (text.includes("INSERT INTO holiday")) {
      this.row = {
        id: "holiday-1",
        month: params?.[0],
        day: params?.[1],
        lunar_solar: params?.[2],
        name: params?.[3],
        created_at: new Date("2026-07-11T00:00:00Z"),
      };
      return { rows: [this.row as unknown as T], rowCount: 1 };
    }
    if (text.includes("UPDATE holiday")) {
      if (!this.row) return { rows: [], rowCount: 0 };
      this.row = {
        id: params?.[0],
        month: params?.[1],
        day: params?.[2],
        lunar_solar: params?.[3],
        name: params?.[4],
        created_at: new Date("2026-07-11T00:00:00Z"),
      };
      return { rows: [this.row as unknown as T], rowCount: 1 };
    }
    if (text.includes("DELETE FROM holiday")) {
      const had = this.row !== null;
      this.row = null;
      return { rows: [], rowCount: had ? 1 : 0 };
    }
    if (text.includes("FROM holiday")) {
      return { rows: this.row ? [this.row as unknown as T] : [], rowCount: this.row ? 1 : 0 };
    }
    throw new Error(`unexpected query: ${text}`);
  }
}

describe("holiday repository", () => {
  it("createHoliday → listHolidays 매핑(snake→camel)", async () => {
    const db = new FakeHolidayDb();
    const created = await createHoliday(db, {
      month: 2,
      day: 1,
      lunarSolar: "LUNAR",
      name: "설날",
    });
    expect(created.id).toBe("holiday-1");
    expect(created.lunarSolar).toBe("LUNAR");
    expect(created.name).toBe("설날");

    const list = await listHolidays(db);
    expect(list[0]?.name).toBe("설날");
  });

  it("listHolidays는 month, day 순으로 정렬한다", async () => {
    const db = new FakeHolidayDb();
    await listHolidays(db);
    expect(db.statements.some((s) => s.includes("ORDER BY month, day"))).toBe(true);
  });

  it("updateHoliday는 없는 id면 null을 반환한다", async () => {
    const db = new FakeHolidayDb(null);
    const updated = await updateHoliday(db, "missing", {
      month: 1,
      day: 1,
      lunarSolar: "SOLAR",
      name: "신정",
    });
    expect(updated).toBeNull();
  });

  it("deleteHoliday는 존재 여부를 boolean으로 반환한다", async () => {
    const db = new FakeHolidayDb({ id: "holiday-1" });
    expect(await deleteHoliday(db, "holiday-1")).toBe(true);
    expect(await deleteHoliday(db, "holiday-1")).toBe(false);
  });
});
