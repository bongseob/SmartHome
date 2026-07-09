import { describe, expect, it } from "vitest";
import type { ActorType, ExecutionStatus, TargetType } from "@smarthome/contracts";
import { IllegalCommandTransitionError } from "@smarthome/contracts";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";
import {
  completeCommandFromAckInTx,
  createCommandWithAuditInTx,
  createCommandWithAuditResultInTx,
  transitionCommandWithAuditInTx,
} from "./command-service.js";
import type { CreateCommandInput } from "./command-repository.js";

interface CommandRow extends QueryResultRow {
  command_id: string;
  session_id: string;
  actor_type: ActorType;
  actor_id: string | null;
  role: string | null;
  target_type: TargetType;
  target_id: string;
  command: string;
  payload: unknown;
  status: ExecutionStatus;
  mqtt_reason_code: number | null;
}

class FakeCommandDb implements QueryExecutor {
  readonly statements: string[] = [];

  constructor(
    private row: CommandRow | null,
    private readonly insertConflicts = false,
  ) {}

  private rows<T extends QueryResultRow>(row: CommandRow): T[] {
    return [row as unknown as T];
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    this.statements.push(text);
    if (text.includes("SELECT") && text.includes("FOR UPDATE")) {
      return { rows: this.row ? this.rows<T>({ ...this.row }) : [], rowCount: this.row ? 1 : 0 };
    }
    if (text.includes("SELECT") && text.includes("FROM command")) {
      return { rows: this.row ? this.rows<T>({ ...this.row }) : [], rowCount: this.row ? 1 : 0 };
    }
    if (text.includes("INSERT INTO command")) {
      if (this.insertConflicts) {
        return { rows: [], rowCount: 0 };
      }
      this.row = {
        command_id: params?.[0] as string,
        session_id: params?.[1] as string,
        actor_type: params?.[2] as ActorType,
        actor_id: params?.[3] as string | null,
        role: params?.[4] as string | null,
        target_type: params?.[5] as TargetType,
        target_id: params?.[6] as string,
        command: params?.[7] as string,
        payload: params?.[8],
        status: "CREATED",
        mqtt_reason_code: null,
      };
      return { rows: this.rows<T>({ ...this.row }), rowCount: 1 };
    }
    if (text.includes("UPDATE command")) {
      if (!this.row) return { rows: [], rowCount: 0 };
      const status = params?.[1] as ExecutionStatus;
      const mqttReasonCode = params?.[2] as number | null;
      this.row = { ...this.row, status, mqtt_reason_code: mqttReasonCode };
      return { rows: this.rows<T>({ ...this.row }), rowCount: 1 };
    }
    if (text.includes("INSERT INTO audit_log")) {
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected query: ${text}`);
  }
}

function commandRow(status: ExecutionStatus): CommandRow {
  return {
    command_id: "CMD-1",
    session_id: "S-1",
    actor_type: "USER",
    actor_id: "11111111-1111-1111-1111-111111111111",
    role: "USER",
    target_type: "DEVICE",
    target_id: "22222222-2222-2222-2222-222222222222",
    command: "turn_on",
    payload: { command: "turn_on" },
    status,
    mqtt_reason_code: null,
  };
}

function createInput(): CreateCommandInput {
  return {
    commandId: "CMD-1",
    sessionId: "S-1",
    actorType: "USER",
    actorId: "11111111-1111-1111-1111-111111111111",
    role: "USER",
    targetType: "DEVICE",
    targetId: "22222222-2222-2222-2222-222222222222",
    command: "turn_on",
    payload: { command: "turn_on" },
  };
}

describe("createCommandWithAuditInTx", () => {
  it("새 command는 CREATED row와 audit를 같은 호출 흐름에서 만든다", async () => {
    const db = new FakeCommandDb(null);

    const created = await createCommandWithAuditInTx(db, createInput());

    expect(created.status).toBe("CREATED");
    expect(db.statements.some((s) => s.includes("INSERT INTO command"))).toBe(true);
    expect(db.statements.some((s) => s.includes("INSERT INTO audit_log"))).toBe(true);
  });

  it("중복 commandId는 기존 command를 반환하고 CREATED audit를 추가하지 않는다", async () => {
    const db = new FakeCommandDb(commandRow("PENDING"), true);

    const result = await createCommandWithAuditResultInTx(db, createInput());

    expect(result.inserted).toBe(false);
    expect(result.command.status).toBe("PENDING");
    expect(db.statements.some((s) => s.includes("SELECT") && s.includes("FROM command"))).toBe(
      true,
    );
    expect(db.statements.some((s) => s.includes("INSERT INTO audit_log"))).toBe(false);
  });
});

describe("transitionCommandWithAuditInTx", () => {
  it("허용된 전이는 command update와 audit insert를 수행한다", async () => {
    const db = new FakeCommandDb(commandRow("CREATED"));

    const updated = await transitionCommandWithAuditInTx(db, {
      commandId: "CMD-1",
      toStatus: "PENDING",
      reason: "accepted",
    });

    expect(updated.status).toBe("PENDING");
    expect(db.statements.some((s) => s.includes("FOR UPDATE"))).toBe(true);
    expect(db.statements.some((s) => s.includes("UPDATE command"))).toBe(true);
    expect(db.statements.some((s) => s.includes("INSERT INTO audit_log"))).toBe(true);
  });

  it("상태 건너뛰기는 update/audit 없이 실패한다", async () => {
    const db = new FakeCommandDb(commandRow("CREATED"));

    await expect(
      transitionCommandWithAuditInTx(db, {
        commandId: "CMD-1",
        toStatus: "SUCCEEDED",
        reason: "skip",
      }),
    ).rejects.toBeInstanceOf(IllegalCommandTransitionError);

    expect(db.statements.some((s) => s.includes("UPDATE command"))).toBe(false);
    expect(db.statements.some((s) => s.includes("INSERT INTO audit_log"))).toBe(false);
  });

  it("FAILED 전이는 MQTT reason code를 command와 audit에 반영한다", async () => {
    const db = new FakeCommandDb(commandRow("IN_PROGRESS"));

    const updated = await transitionCommandWithAuditInTx(db, {
      commandId: "CMD-1",
      toStatus: "FAILED",
      reason: "device rejected",
      mqttReasonCode: 128,
    });

    expect(updated.status).toBe("FAILED");
    expect(updated.mqttReasonCode).toBe(128);
  });
});

describe("completeCommandFromAckInTx (terminal ack 레이스 흡수)", () => {
  it("PENDING에서 종결 ack가 오면 IN_PROGRESS를 거쳐 순차 전이한다(전이마다 audit)", async () => {
    const db = new FakeCommandDb(commandRow("PENDING"));

    const result = await completeCommandFromAckInTx(db, {
      commandId: "CMD-1",
      toStatus: "SUCCEEDED",
      reason: "device ack SUCCEEDED",
    });

    expect(result.applied).toBe(true);
    expect(result.command.status).toBe("SUCCEEDED");
    // PENDING→IN_PROGRESS, IN_PROGRESS→SUCCEEDED = update 2회 + audit 2행
    expect(db.statements.filter((s) => s.includes("UPDATE command")).length).toBe(2);
    expect(db.statements.filter((s) => s.includes("INSERT INTO audit_log")).length).toBe(2);
  });

  it("IN_PROGRESS에서는 단일 전이로 종결한다", async () => {
    const db = new FakeCommandDb(commandRow("IN_PROGRESS"));

    const result = await completeCommandFromAckInTx(db, {
      commandId: "CMD-1",
      toStatus: "FAILED",
      reason: "device ack FAILED",
      mqttReasonCode: 135,
    });

    expect(result.applied).toBe(true);
    expect(result.command.status).toBe("FAILED");
    expect(db.statements.filter((s) => s.includes("UPDATE command")).length).toBe(1);
  });

  it("이미 종결된 명령의 중복/늦은 ack는 전이 없이 no-op", async () => {
    const db = new FakeCommandDb(commandRow("TIMED_OUT"));

    const result = await completeCommandFromAckInTx(db, {
      commandId: "CMD-1",
      toStatus: "SUCCEEDED",
      reason: "late ack",
    });

    expect(result.applied).toBe(false);
    expect(result.command.status).toBe("TIMED_OUT");
    expect(db.statements.some((s) => s.includes("UPDATE command"))).toBe(false);
  });

  it("비종결 상태로는 호출할 수 없다", async () => {
    const db = new FakeCommandDb(commandRow("PENDING"));

    await expect(
      completeCommandFromAckInTx(db, {
        commandId: "CMD-1",
        toStatus: "IN_PROGRESS",
        reason: "not terminal",
      }),
    ).rejects.toThrow("종결 상태 전용");
  });
});
