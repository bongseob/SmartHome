import { describe, expect, it } from "vitest";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";
import {
  addTimeProgramSlot,
  createTimeProgram,
  deleteTimeProgramSlot,
  listTimePrograms,
  listTimeProgramGroups,
  mapTimeProgramGroup,
} from "./time-program-repository.js";

class FakeTpDb implements QueryExecutor {
  readonly statements: string[] = [];
  private programRow: Record<string, unknown> | null = null;
  private slotRow: Record<string, unknown> | null = null;

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    this.statements.push(text);

    if (text.includes("INSERT INTO time_program_slot")) {
      this.slotRow = {
        id: "slot-1",
        time_program_id: params?.[0],
        day_of_week: params?.[1],
        is_holiday: params?.[2],
        at_time: params?.[3],
        power_on: params?.[4],
      };
      return { rows: [this.slotRow as unknown as T], rowCount: 1 };
    }
    if (text.includes("DELETE FROM time_program_slot")) {
      const had = this.slotRow !== null;
      this.slotRow = null;
      return { rows: [], rowCount: had ? 1 : 0 };
    }
    if (text.includes("INSERT INTO time_program")) {
      this.programRow = {
        id: "tp-1",
        program_no: params?.[0],
        name: params?.[1],
        enabled: true,
        created_at: new Date("2026-07-11T00:00:00Z"),
      };
      return { rows: [this.programRow as unknown as T], rowCount: 1 };
    }
    if (text.includes("FROM time_program_group")) {
      return {
        rows: [{ group_id: "group-1", group_name: "1층 조명" }] as unknown as T[],
        rowCount: 1,
      };
    }
    if (text.includes("INSERT INTO time_program_group")) {
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("FROM time_program")) {
      return { rows: this.programRow ? [this.programRow as unknown as T] : [], rowCount: this.programRow ? 1 : 0 };
    }
    throw new Error(`unexpected query: ${text}`);
  }
}

describe("time program repository", () => {
  it("createTimeProgram → listTimePrograms 매핑", async () => {
    const db = new FakeTpDb();
    const created = await createTimeProgram(db, { programNo: 1, name: "평일 점등" });
    expect(created.id).toBe("tp-1");
    expect(created.programNo).toBe(1);
    expect(created.enabled).toBe(true);

    const list = await listTimePrograms(db);
    expect(list[0]?.name).toBe("평일 점등");
  });

  it("addTimeProgramSlot은 요일/공휴일·시각·ON/OFF를 매핑한다", async () => {
    const db = new FakeTpDb();
    const holidaySlot = await addTimeProgramSlot(db, {
      timeProgramId: "tp-1",
      dayOfWeek: null,
      isHoliday: true,
      atTime: "09:00",
      powerOn: true,
    });
    expect(holidaySlot.isHoliday).toBe(true);
    expect(holidaySlot.dayOfWeek).toBeNull();
    expect(holidaySlot.powerOn).toBe(true);
  });

  it("deleteTimeProgramSlot은 program+slot 두 조건으로 삭제한다", async () => {
    const db = new FakeTpDb();
    await addTimeProgramSlot(db, {
      timeProgramId: "tp-1",
      dayOfWeek: 1,
      isHoliday: false,
      atTime: "08:00",
      powerOn: true,
    });
    const removed = await deleteTimeProgramSlot(db, "tp-1", "slot-1");
    expect(removed).toBe(true);
    expect(db.statements.some((s) => s.includes("time_program_id::text = $2"))).toBe(true);
  });

  it("mapTimeProgramGroup 후 listTimeProgramGroups가 그룹명을 반환한다", async () => {
    const db = new FakeTpDb();
    await mapTimeProgramGroup(db, "tp-1", "group-1");
    const groups = await listTimeProgramGroups(db, "tp-1");
    expect(groups[0]).toEqual({ groupId: "group-1", groupName: "1층 조명" });
  });
});
