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

/** alarm_log(policy_id, device_id) WHERE state IN ('RAISED','ACK','SNOOZED') 부분 유니크 인덱스 위반. */
const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION;
}

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
  let alarm: AlarmRecord;
  try {
    // SAVEPOINT 없이 바로 INSERT하면, unique_violation 발생 시 Postgres가 트랜잭션 전체를
    // "aborted" 상태로 만들어버려 그 뒤의 findOpenAlarm 재조회조차 25P02(current transaction
    // is aborted)로 실패한다 — 실제 동시 요청 10개로 재현해서 발견함. SAVEPOINT로 INSERT만
    // 부분 롤백해서 바깥 트랜잭션(withTransaction)은 계속 살아있게 한다.
    await db.query("SAVEPOINT raise_alarm_insert");
    alarm = await insertAlarmLog(db, {
      policyId: input.policy.id,
      deviceId: input.deviceId,
      tier: input.policy.tier,
      severity: input.policy.severity,
      message: input.message,
    });
    await db.query("RELEASE SAVEPOINT raise_alarm_insert");
  } catch (err) {
    // findOpenAlarm(SELECT)과 insertAlarmLog(INSERT) 사이의 틈에 다른 트랜잭션이 먼저 같은
    // policy+device로 알람을 만들면 idx_alarm_log_open_unique 위반으로 여기 걸린다
    // (코드 리뷰 P1 #13) — 에러로 취급하지 않고 그 알람을 대신 반환해 findOpenAlarm이 먼저
    // 찾았을 때와 동일한 dedup 결과가 되게 한다.
    if (isUniqueViolation(err)) {
      await db.query("ROLLBACK TO SAVEPOINT raise_alarm_insert");
      const winner = await findOpenAlarm(db, input.policy.id, input.deviceId);
      if (winner) {
        return { alarm: winner, raised: false };
      }
    }
    throw err;
  }
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
    const applied = await withTransaction(async (client) => {
      // bumpEscalatedLevel이 false면 다른 sweep(동시 실행되는 다른 gateway 인스턴스 등)이 이미
      // 이 레벨을 먼저 올렸다는 뜻이다(코드 리뷰 P1 #13) — audit도 남기지 않고 결과에도 넣지
      // 않아 알림이 중복 발송되지 않게 한다.
      const bumped = await bumpEscalatedLevel(client, item.alarm.id, item.level);
      if (!bumped) return false;
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
      return true;
    });
    if (!applied) continue;
    results.push({
      alarm: item.alarm,
      level: item.level,
      notifyChannelId: item.notifyChannelId,
      notifyRole: item.notifyRole,
    });
  }
  return results;
}
