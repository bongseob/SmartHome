import { describe, expect, it } from "vitest";
import type { AlarmState } from "@smarthome/contracts";
import { IllegalAlarmTransitionError } from "@smarthome/contracts";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";
import {
  AlarmNotFoundError,
  raiseAlarmFromPolicyInTx,
  recordAlarmActionInTx,
  resolveOpenAlarmsForDeviceInTx,
} from "./alarm-service.js";

interface AlarmRow extends QueryResultRow {
  id: string;
  policy_id: string | null;
  device_id: string | null;
  tier: string;
  severity: string;
  message: string | null;
  state: AlarmState;
  raised_at: Date;
  snoozed_until: Date | null;
  resolved_at: Date | null;
  escalated_level: number;
}

function alarmRow(state: AlarmState): AlarmRow {
  return {
    id: "1",
    policy_id: "policy-1",
    device_id: "device-1",
    tier: "REACTIVE",
    severity: "CRITICAL",
    message: "가스 누출 감지",
    state,
    raised_at: new Date("2026-07-10T00:00:00Z"),
    snoozed_until: null,
    resolved_at: null,
    escalated_level: 0,
  };
}

class FakeAlarmDb implements QueryExecutor {
  readonly statements: string[] = [];
  constructor(private row: AlarmRow | null) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    this.statements.push(text);

    if (text.includes("SAVEPOINT")) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes("SELECT") && text.includes("FROM alarm_log") && text.includes("FOR UPDATE")) {
      return { rows: this.row ? [{ ...this.row } as unknown as T] : [], rowCount: this.row ? 1 : 0 };
    }
    if (text.includes("SELECT") && text.includes("FROM alarm_log") && text.includes("WHERE policy_id")) {
      // findOpenAlarm
      const open = this.row && ["RAISED", "ACK", "SNOOZED"].includes(this.row.state);
      return { rows: open ? [{ ...this.row! } as unknown as T] : [], rowCount: open ? 1 : 0 };
    }
    if (text.includes("UPDATE alarm_log")) {
      if (!this.row) return { rows: [], rowCount: 0 };
      const state = params?.[1] as AlarmState;
      const snoozedUntil = params?.[2] as Date | null;
      const resolvedAt = params?.[3] as Date | null;
      this.row = {
        ...this.row,
        state,
        snoozed_until: snoozedUntil ?? this.row.snoozed_until,
        resolved_at: resolvedAt ?? this.row.resolved_at,
      };
      return { rows: [{ ...this.row } as unknown as T], rowCount: 1 };
    }
    if (text.includes("INSERT INTO alarm_log")) {
      this.row = alarmRow("RAISED");
      return { rows: [{ ...this.row } as unknown as T], rowCount: 1 };
    }
    if (text.includes("INSERT INTO alarm_action")) {
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("INSERT INTO audit_log")) {
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected query: ${text}`);
  }
}

describe("recordAlarmActionInTx", () => {
  it("ACK: RAISED→ACK 전이 + alarm_action + audit_log", async () => {
    const db = new FakeAlarmDb(alarmRow("RAISED"));

    const updated = await recordAlarmActionInTx(db, {
      alarmId: "1",
      actorId: "user-1",
      actorType: "USER",
      actionType: "ACK",
    });

    expect(updated.state).toBe("ACK");
    expect(db.statements.some((s) => s.includes("UPDATE alarm_log"))).toBe(true);
    expect(db.statements.some((s) => s.includes("INSERT INTO alarm_action"))).toBe(true);
    expect(db.statements.some((s) => s.includes("INSERT INTO audit_log"))).toBe(true);
  });

  it("이미 RESOLVED인 알람에 ACK 시도하면 상태 건너뛰기로 거부되고 아무것도 기록하지 않는다", async () => {
    const db = new FakeAlarmDb(alarmRow("RESOLVED"));

    await expect(
      recordAlarmActionInTx(db, { alarmId: "1", actorId: "user-1", actorType: "USER", actionType: "ACK" }),
    ).rejects.toBeInstanceOf(IllegalAlarmTransitionError);

    expect(db.statements.some((s) => s.includes("UPDATE alarm_log"))).toBe(false);
    expect(db.statements.some((s) => s.includes("INSERT INTO alarm_action"))).toBe(false);
    expect(db.statements.some((s) => s.includes("INSERT INTO audit_log"))).toBe(false);
  });

  it("NOTE는 상태를 바꾸지 않고 조치 이력 + audit만 남긴다", async () => {
    const db = new FakeAlarmDb(alarmRow("ACK"));

    const updated = await recordAlarmActionInTx(db, {
      alarmId: "1",
      actorId: "user-1",
      actorType: "USER",
      actionType: "NOTE",
      note: "현장 확인 중",
    });

    expect(updated.state).toBe("ACK");
    expect(db.statements.some((s) => s.includes("UPDATE alarm_log"))).toBe(false);
    expect(db.statements.some((s) => s.includes("INSERT INTO alarm_action"))).toBe(true);
    expect(db.statements.some((s) => s.includes("INSERT INTO audit_log"))).toBe(true);
  });

  it("존재하지 않는 알람이면 AlarmNotFoundError", async () => {
    const db = new FakeAlarmDb(null);
    await expect(
      recordAlarmActionInTx(db, { alarmId: "999", actorId: "user-1", actorType: "USER", actionType: "ACK" }),
    ).rejects.toBeInstanceOf(AlarmNotFoundError);
  });
});

const policyStub = { id: "policy-1", tier: "REACTIVE", severity: "CRITICAL" } as const;

describe("raiseAlarmFromPolicyInTx", () => {
  it("열린 알람이 없으면 새로 raise하고 audit를 남긴다", async () => {
    const db = new FakeAlarmDb(null);

    const result = await raiseAlarmFromPolicyInTx(db, {
      policy: policyStub,
      deviceId: "device-1",
      message: "가스 누출 감지",
    });

    expect(result.raised).toBe(true);
    expect(result.alarm.state).toBe("RAISED");
    expect(db.statements.some((s) => s.includes("INSERT INTO alarm_log"))).toBe(true);
    expect(db.statements.some((s) => s.includes("INSERT INTO audit_log"))).toBe(true);
  });

  it("이미 열린 알람이 있으면 raised:false로 재사용하고 새 알람/audit를 만들지 않는다(중복 억제)", async () => {
    const db = new FakeAlarmDb(alarmRow("ACK"));

    const result = await raiseAlarmFromPolicyInTx(db, {
      policy: policyStub,
      deviceId: "device-1",
      message: "가스 누출 감지",
    });

    expect(result.raised).toBe(false);
    expect(result.alarm.state).toBe("ACK");
    expect(db.statements.some((s) => s.includes("INSERT INTO alarm_log"))).toBe(false);
    expect(db.statements.some((s) => s.includes("INSERT INTO audit_log"))).toBe(false);
  });

  it("동시 raise 경쟁(unique_violation)이 나면 에러로 취급하지 않고 승자의 알람을 반환한다(코드 리뷰 P1 #13)", async () => {
    // findOpenAlarm(첫 조회)은 아직 아무도 못 봤다고 응답하지만, insertAlarmLog 시점에는
    // 다른 트랜잭션이 이미 커밋해 idx_alarm_log_open_unique 위반이 나는 상황을 재현한다.
    class RacingAlarmDb implements QueryExecutor {
      statements: string[] = [];
      private insertAttempted = false;
      async query<T extends QueryResultRow = QueryResultRow>(
        text: string,
      ): Promise<{ rows: T[]; rowCount: number | null }> {
        this.statements.push(text);
        if (text.includes("SAVEPOINT")) {
          return { rows: [] as T[], rowCount: 0 };
        }
        if (text.includes("INSERT INTO alarm_log")) {
          this.insertAttempted = true;
          const err = new Error("duplicate key value violates unique constraint") as Error & { code: string };
          err.code = "23505";
          throw err;
        }
        if (text.includes("FROM alarm_log") && text.includes("WHERE policy_id")) {
          // 첫 호출(경쟁 전 조회)은 없음, insert 실패 이후 재조회는 승자의 행을 반환.
          if (!this.insertAttempted) return { rows: [], rowCount: 0 };
          return {
            rows: [{ ...alarmRow("RAISED") } as unknown as T],
            rowCount: 1,
          };
        }
        throw new Error(`unexpected query: ${text}`);
      }
    }

    const db = new RacingAlarmDb();
    const result = await raiseAlarmFromPolicyInTx(db, {
      policy: policyStub,
      deviceId: "device-1",
      message: "가스 누출 감지",
    });

    expect(result.raised).toBe(false);
    expect(result.alarm.state).toBe("RAISED");
    // audit는 승자 쪽에서만 남긴다 — 패자는 남기지 않는다.
    expect(db.statements.some((s) => s.includes("INSERT INTO audit_log"))).toBe(false);
    // SAVEPOINT로 INSERT 실패만 부분 롤백해야 바깥 트랜잭션에서 재조회가 가능하다
    // (SAVEPOINT 없이 바로 재조회하면 Postgres가 "current transaction is aborted"로 거부함
    // — 실제 동시 요청 10개로 재현해서 발견한 버그).
    expect(db.statements.some((s) => s.includes("ROLLBACK TO SAVEPOINT"))).toBe(true);
  });
});

describe("resolveOpenAlarmsForDeviceInTx(코드 리뷰 2026-07-22 — ACK만으론 재발생이 막히던 문제)", () => {
  /** 여러 알람 행을 device_id로 들고 있는 멀티 로우 페이크 DB. */
  class MultiRowAlarmDb implements QueryExecutor {
    readonly statements: string[] = [];
    readonly auditActorTypes: unknown[] = [];
    constructor(private rows: Map<string, AlarmRow>) {}

    async query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: unknown[],
    ): Promise<{ rows: T[]; rowCount: number | null }> {
      this.statements.push(text);

      if (text.includes("SELECT id::text FROM alarm_log WHERE device_id")) {
        const deviceId = params?.[0] as string;
        const open = [...this.rows.values()].filter(
          (r) => r.device_id === deviceId && ["RAISED", "ACK", "SNOOZED"].includes(r.state),
        );
        return { rows: open.map((r) => ({ id: r.id }) as unknown as T), rowCount: open.length };
      }
      if (text.includes("FROM alarm_log") && text.includes("FOR UPDATE")) {
        const id = params?.[0] as string;
        const row = this.rows.get(id) ?? null;
        return { rows: row ? [{ ...row } as unknown as T] : [], rowCount: row ? 1 : 0 };
      }
      if (text.includes("UPDATE alarm_log")) {
        const id = params?.[0] as string;
        const row = this.rows.get(id);
        if (!row) return { rows: [], rowCount: 0 };
        const updated: AlarmRow = {
          ...row,
          state: params?.[1] as AlarmState,
          snoozed_until: (params?.[2] as Date | null) ?? row.snoozed_until,
          resolved_at: (params?.[3] as Date | null) ?? row.resolved_at,
        };
        this.rows.set(id, updated);
        return { rows: [{ ...updated } as unknown as T], rowCount: 1 };
      }
      if (text.includes("INSERT INTO alarm_action")) {
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("INSERT INTO audit_log")) {
        this.auditActorTypes.push(params?.[0]);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${text}`);
    }
  }

  it("device의 열린 알람(RAISED/ACK/SNOOZED)을 전부 RESOLVED로 전이하고 actorType=SYSTEM으로 감사 기록한다", async () => {
    const rows = new Map<string, AlarmRow>([
      ["1", { ...alarmRow("RAISED"), id: "1", device_id: "device-1", message: "ON → ALARM" }],
      ["2", { ...alarmRow("ACK"), id: "2", device_id: "device-1", message: "ALARM → ON" }],
      // 다른 device의 알람은 건드리지 않아야 한다.
      ["3", { ...alarmRow("RAISED"), id: "3", device_id: "device-2", message: "다른 기기 알람" }],
    ]);
    const db = new MultiRowAlarmDb(rows);

    const resolved = await resolveOpenAlarmsForDeviceInTx(db, "device-1", "기기가 ON(정상)로 복귀해 자동 해결");

    expect(resolved.map((a) => a.id).sort()).toEqual(["1", "2"]);
    expect(resolved.every((a) => a.state === "RESOLVED")).toBe(true);
    expect(db.auditActorTypes).toEqual(["SYSTEM", "SYSTEM"]);
    // device-2의 알람은 그대로 RAISED 유지(건드리지 않음).
    expect(rows.get("3")?.state).toBe("RAISED");
  });

  it("열린 알람이 없으면 빈 배열을 반환하고 아무 것도 갱신하지 않는다(no-op)", async () => {
    const db = new MultiRowAlarmDb(new Map());

    const resolved = await resolveOpenAlarmsForDeviceInTx(db, "device-1", "기기가 ON(정상)로 복귀해 자동 해결");

    expect(resolved).toEqual([]);
    expect(db.statements.some((s) => s.includes("UPDATE alarm_log"))).toBe(false);
  });

  it("이미 RESOLVED인 알람은 건드리지 않는다", async () => {
    const rows = new Map<string, AlarmRow>([
      ["1", { ...alarmRow("RESOLVED"), id: "1", device_id: "device-1" }],
    ]);
    const db = new MultiRowAlarmDb(rows);

    const resolved = await resolveOpenAlarmsForDeviceInTx(db, "device-1", "기기가 ON(정상)로 복귀해 자동 해결");

    expect(resolved).toEqual([]);
  });
});
