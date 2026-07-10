import { assertAlarmTransition, type ActorType, type AlarmActionType, type AlarmState, type Role } from "@smarthome/contracts";
import { query, withTransaction } from "./pool.js";
import { insertAuditLog, type QueryExecutor } from "./audit-repository.js";
import {
  bumpEscalatedLevel,
  findOpenAlarm,
  insertAlarmAction,
  insertAlarmLog,
  listDueEscalations,
  lockAlarmById,
  updateAlarmState,
  type AlarmPolicyRecord,
  type AlarmRecord,
} from "./alarm-repository.js";

const dbExecutor: QueryExecutor = { query };

export class AlarmNotFoundError extends Error {
  constructor(public readonly alarmId: string) {
    super(`alarm not found: ${alarmId}`);
    this.name = "AlarmNotFoundError";
  }
}

const ACTION_TARGET_STATE: Record<Exclude<AlarmActionType, "NOTE">, AlarmState> = {
  ACK: "ACK",
  SNOOZE: "SNOOZED",
  RESOLVE: "RESOLVED",
};

export interface AlarmActionInput {
  alarmId: string;
  actorId: string | null;
  actorType: ActorType;
  actionType: AlarmActionType;
  note?: string | null;
  /** actionType이 SNOOZE일 때 필수. */
  snoozeUntil?: Date | null;
}

function auditReason(note: string | null | undefined, fallback: string): string {
  return note?.trim() || fallback;
}

/**
 * 알람 Ack/Snooze/Resolve/Note. 상태 전이(있는 경우) + alarm_action + audit_log를
 * 하나의 transaction으로 묶는다(PROJECT_RULES §6 "알람 승인은 감사 로그 대상").
 * NOTE는 상태를 바꾸지 않고 조치 이력만 남긴다.
 */
export async function recordAlarmAction(input: AlarmActionInput): Promise<AlarmRecord> {
  return withTransaction((client) => recordAlarmActionInTx(client, input));
}

export async function recordAlarmActionInTx(
  db: QueryExecutor,
  input: AlarmActionInput,
): Promise<AlarmRecord> {
  const current = await lockAlarmById(db, input.alarmId);
  if (!current) {
    throw new AlarmNotFoundError(input.alarmId);
  }

  let updated = current;
  if (input.actionType !== "NOTE") {
    const toState = ACTION_TARGET_STATE[input.actionType];
    assertAlarmTransition(current.state, toState);
    updated = await updateAlarmState(db, input.alarmId, {
      state: toState,
      snoozedUntil: input.actionType === "SNOOZE" ? (input.snoozeUntil ?? null) : null,
      resolvedAt: input.actionType === "RESOLVE" ? new Date() : null,
    });
  }

  await insertAlarmAction(db, {
    alarmId: input.alarmId,
    actorId: input.actorId,
    actionType: input.actionType,
    note: input.note ?? null,
  });

  await insertAuditLog(db, {
    actorType: input.actorType,
    actorId: input.actorId,
    targetType: "ALARM",
    targetId: input.alarmId,
    command: input.actionType,
    reason: auditReason(input.note, `alarm ${input.actionType.toLowerCase()}`),
    executionStatus: "SUCCEEDED",
    mqttReasonCode: null,
    sessionId: null,
    commandId: null,
  });

  return updated;
}

export interface RaiseAlarmFromPolicyInput {
  policy: Pick<AlarmPolicyRecord, "id" | "tier" | "severity">;
  deviceId: string;
  message: string;
}

export interface RaiseAlarmResult {
  alarm: AlarmRecord;
  /** false면 이미 열려 있는 알람이 있어 새로 만들지 않고 기존 알람을 반환(중복 억제). */
  raised: boolean;
}

/** policy 위반 감지 시 알람을 올린다. 같은 policy+device로 이미 열린 알람이 있으면 재발행하지 않는다. */
export async function raiseAlarmFromPolicy(input: RaiseAlarmFromPolicyInput): Promise<RaiseAlarmResult> {
  return withTransaction((client) => raiseAlarmFromPolicyInTx(client, input));
}

export async function raiseAlarmFromPolicyInTx(
  db: QueryExecutor,
  input: RaiseAlarmFromPolicyInput,
): Promise<RaiseAlarmResult> {
  const existing = await findOpenAlarm(db, input.policy.id, input.deviceId);
  if (existing) {
    return { alarm: existing, raised: false };
  }
  const alarm = await insertAlarmLog(db, {
    policyId: input.policy.id,
    deviceId: input.deviceId,
    tier: input.policy.tier,
    severity: input.policy.severity,
    message: input.message,
  });
  await insertAuditLog(db, {
    actorType: "SYSTEM",
    actorId: null,
    targetType: "ALARM",
    targetId: alarm.id,
    command: "RAISE",
    reason: input.message,
    executionStatus: "SUCCEEDED",
    mqttReasonCode: null,
    sessionId: null,
    commandId: null,
  });
  return { alarm, raised: true };
}

// ─── Escalation sweep ────────────────────────────────────────────────────

export interface EscalationToNotify {
  alarm: AlarmRecord;
  level: number;
  notifyChannelId: string | null;
  notifyRole: Role | null;
}

/**
 * 조건을 만족하는(after_sec 경과, 아직 미발동) 에스컬레이션 레벨을 찾아 escalated_level을 올리고
 * audit_log에 기록한 뒤, 알림 발송에 필요한 정보를 반환한다(실제 발송은 호출부 책임 — HTTP 호출을
 * DB transaction 안에서 하지 않는다).
 */
export async function sweepDueEscalations(now: Date = new Date()): Promise<EscalationToNotify[]> {
  const due = await listDueEscalations(dbExecutor, now);
  const results: EscalationToNotify[] = [];
  for (const item of due) {
    await withTransaction(async (client) => {
      await bumpEscalatedLevel(client, item.alarm.id, item.level);
      await insertAuditLog(client, {
        actorType: "SYSTEM",
        actorId: null,
        targetType: "ALARM",
        targetId: item.alarm.id,
        command: "ESCALATE",
        reason: `escalation level ${item.level}`,
        executionStatus: "SUCCEEDED",
        mqttReasonCode: null,
        sessionId: null,
        commandId: null,
      });
    });
    results.push({
      alarm: item.alarm,
      level: item.level,
      notifyChannelId: item.notifyChannelId,
      notifyRole: item.notifyRole,
    });
  }
  return results;
}
