import { assertTransition, type ExecutionStatus } from "@smarthome/contracts";
import { withTransaction } from "./pool.js";
import { insertAuditLog, type QueryExecutor } from "./audit-repository.js";
import {
  insertCommandCreated,
  lockCommandById,
  updateCommandStatus,
  type CommandRecord,
  type CreateCommandResult,
  type CreateCommandInput,
} from "./command-repository.js";

export interface TransitionCommandInput {
  commandId: string;
  toStatus: ExecutionStatus;
  reason: string;
  mqttReasonCode?: number | null;
}

export class CommandNotFoundError extends Error {
  constructor(public readonly commandId: string) {
    super(`command not found: ${commandId}`);
    this.name = "CommandNotFoundError";
  }
}

function auditReason(reason: string): string {
  return reason.trim() || "command lifecycle";
}

async function insertCommandAudit(
  db: QueryExecutor,
  command: CommandRecord,
  status: ExecutionStatus,
  reason: string,
  mqttReasonCode: number | null,
): Promise<void> {
  await insertAuditLog(db, {
    actorType: command.actorType,
    actorId: command.actorId,
    targetType: command.targetType,
    targetId: command.targetId,
    command: command.command,
    reason: auditReason(reason),
    executionStatus: status,
    mqttReasonCode,
    sessionId: command.sessionId,
    commandId: command.commandId,
  });
}

/**
 * command row 생성과 CREATED audit를 같은 transaction에서 처리한다.
 * 중복 commandId는 멱등성 재요청으로 보고 기존 command를 반환하며 audit를 추가하지 않는다.
 */
export async function createCommandWithAudit(
  input: CreateCommandInput,
): Promise<CommandRecord> {
  const result = await createCommandWithAuditResult(input);
  return result.command;
}

export async function createCommandWithAuditResult(
  input: CreateCommandInput,
): Promise<CreateCommandResult> {
  return withTransaction(async (client) => createCommandWithAuditResultInTx(client, input));
}

export async function createCommandWithAuditInTx(
  db: QueryExecutor,
  input: CreateCommandInput,
): Promise<CommandRecord> {
  const result = await createCommandWithAuditResultInTx(db, input);
  return result.command;
}

export async function createCommandWithAuditResultInTx(
  db: QueryExecutor,
  input: CreateCommandInput,
): Promise<CreateCommandResult> {
  const result = await insertCommandCreated(db, input);
  if (result.inserted) {
    await insertCommandAudit(db, result.command, "CREATED", "command created", null);
  }
  return result;
}

/**
 * 현재 상태를 FOR UPDATE로 잠근 뒤 허용된 전이만 수행하고, 같은 transaction에서 audit를 남긴다.
 */
export async function transitionCommandWithAudit(
  input: TransitionCommandInput,
): Promise<CommandRecord> {
  return withTransaction(async (client) => transitionCommandWithAuditInTx(client, input));
}

export interface AckCompletionResult {
  command: CommandRecord;
  /** false = 이미 종결 상태라 전이 없음(중복/늦은 ack) */
  applied: boolean;
}

export const TERMINAL_STATUSES: ReadonlySet<ExecutionStatus> = new Set([
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
]);

/**
 * 기기 ack로 명령을 종결한다. 발행측의 IN_PROGRESS 전이가 커밋되기 전에 종결 ack가
 * 도착하는 레이스를 흡수: 현재 상태가 PENDING이면 같은 transaction 안에서
 * IN_PROGRESS를 거쳐 종결까지 순차 전이한다(전이마다 audit 1행, 상태 건너뛰기 없음).
 * 이미 종결된 명령이면 전이 없이 반환한다(applied=false) — 중복 ack 멱등 처리.
 */
export async function completeCommandFromAck(
  input: TransitionCommandInput,
): Promise<AckCompletionResult> {
  return withTransaction(async (client) => completeCommandFromAckInTx(client, input));
}

export async function completeCommandFromAckInTx(
  db: QueryExecutor,
  input: TransitionCommandInput,
): Promise<AckCompletionResult> {
  if (!TERMINAL_STATUSES.has(input.toStatus)) {
    throw new Error(`completeCommandFromAck는 종결 상태 전용: ${input.toStatus}`);
  }
  const current = await lockCommandById(db, input.commandId);
  if (!current) {
    throw new CommandNotFoundError(input.commandId);
  }
  if (TERMINAL_STATUSES.has(current.status)) {
    return { command: current, applied: false };
  }
  let record = current;
  if (record.status === "PENDING") {
    record = await transitionCommandWithAuditInTx(db, {
      commandId: input.commandId,
      toStatus: "IN_PROGRESS",
      reason: "implied by terminal device ack",
    });
  }
  record = await transitionCommandWithAuditInTx(db, input);
  return { command: record, applied: true };
}

export async function transitionCommandWithAuditInTx(
  db: QueryExecutor,
  input: TransitionCommandInput,
): Promise<CommandRecord> {
  const current = await lockCommandById(db, input.commandId);
  if (!current) {
    throw new CommandNotFoundError(input.commandId);
  }

  assertTransition(current.status, input.toStatus);
  const mqttReasonCode = input.mqttReasonCode ?? current.mqttReasonCode;
  const updated = await updateCommandStatus(db, input.commandId, input.toStatus, mqttReasonCode);
  await insertCommandAudit(db, updated, input.toStatus, input.reason, mqttReasonCode);
  return updated;
}
