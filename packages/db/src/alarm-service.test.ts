import { describe, expect, it } from "vitest";
import type { AlarmState } from "@smarthome/contracts";
import { IllegalAlarmTransitionError } from "@smarthome/contracts";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";
import { AlarmNotFoundError, raiseAlarmFromPolicyInTx, recordAlarmActionInTx } from "./alarm-service.js";

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
});
