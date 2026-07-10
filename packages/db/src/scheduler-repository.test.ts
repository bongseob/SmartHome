import { describe, expect, it } from "vitest";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";
import {
  createScheduler,
  getLastRunForScheduler,
  insertScheduleRun,
  listGroupDeviceIds,
  listSchedulers,
  lockSchedulerById,
} from "./scheduler-repository.js";

class FakeSchedulerDb implements QueryExecutor {
  readonly statements: string[] = [];
  constructor(
    private schedulerRow: Record<string, unknown> | null = null,
    private runRow: Record<string, unknown> | null = null,
  ) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    this.statements.push(text);

    if (text.includes("INSERT INTO scheduler")) {
      this.schedulerRow = {
        id: "sched-1",
        name: params?.[0],
        target_type: params?.[1],
        target_id: params?.[2],
        schedule_type: params?.[3],
        run_at: params?.[4],
        cron_expr: params?.[5],
        days_of_week: params?.[6],
        day_of_month: params?.[7],
        event_trigger: params?.[8],
        payload: params?.[9],
        enabled: true,
      };
      return { rows: [this.schedulerRow as unknown as T], rowCount: 1 };
    }
    if (text.includes("FROM scheduler") && text.includes("FOR UPDATE")) {
      return { rows: this.schedulerRow ? [this.schedulerRow as unknown as T] : [], rowCount: this.schedulerRow ? 1 : 0 };
    }
    if (text.includes("FROM scheduler")) {
      return { rows: this.schedulerRow ? [this.schedulerRow as unknown as T] : [], rowCount: this.schedulerRow ? 1 : 0 };
    }
    if (text.includes("INSERT INTO schedule_run")) {
      this.runRow = {
        id: "run-1",
        scheduler_id: params?.[0],
        fired_at: new Date("2026-07-10T10:00:00Z"),
        command_id: params?.[1],
        status: params?.[2],
      };
      return { rows: [this.runRow as unknown as T], rowCount: 1 };
    }
    if (text.includes("FROM schedule_run")) {
      return { rows: this.runRow ? [this.runRow as unknown as T] : [], rowCount: this.runRow ? 1 : 0 };
    }
    if (text.includes("FROM device_group_mapping")) {
      return {
        rows: [{ device_id: "device-1" }, { device_id: "device-2" }] as unknown as T[],
        rowCount: 2,
      };
    }
    throw new Error(`unexpected query: ${text}`);
  }
}

describe("scheduler repository", () => {
  it("createScheduler → listSchedulers round trip 매핑", async () => {
    const db = new FakeSchedulerDb();
    const created = await createScheduler(db, {
      name: "야간 소등",
      targetType: "GROUP",
      targetId: "group-1",
      scheduleType: "CRON",
      cronExpr: "0 23 * * *",
      payload: { command: "turn_off" },
    });
    expect(created.name).toBe("야간 소등");
    expect(created.scheduleType).toBe("CRON");

    const list = await listSchedulers(db);
    expect(list[0]?.id).toBe("sched-1");
  });

  it("lockSchedulerById는 FOR UPDATE SKIP LOCKED를 사용한다", async () => {
    const db = new FakeSchedulerDb({
      id: "sched-1",
      name: "test",
      target_type: "DEVICE",
      target_id: "device-1",
      schedule_type: "ONE_TIME",
      run_at: new Date(),
      cron_expr: null,
      days_of_week: null,
      day_of_month: null,
      event_trigger: null,
      payload: {},
      enabled: true,
    });
    const locked = await lockSchedulerById(db, "sched-1");
    expect(locked?.id).toBe("sched-1");
    expect(db.statements.some((s) => s.includes("FOR UPDATE SKIP LOCKED"))).toBe(true);
  });

  it("listGroupDeviceIds는 device_group_mapping을 조회한다", async () => {
    const db = new FakeSchedulerDb();
    const ids = await listGroupDeviceIds(db, "group-1");
    expect(ids).toEqual(["device-1", "device-2"]);
  });

  it("insertScheduleRun 이후 getLastRunForScheduler가 그 row를 반환한다", async () => {
    const db = new FakeSchedulerDb();
    await insertScheduleRun(db, { schedulerId: "sched-1", commandId: "CMD-1", status: "FIRED" });
    const last = await getLastRunForScheduler(db, "sched-1");
    expect(last?.commandId).toBe("CMD-1");
    expect(last?.status).toBe("FIRED");
  });
});
