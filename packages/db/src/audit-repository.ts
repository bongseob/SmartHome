import type { ActorType, ExecutionStatus } from "@smarthome/contracts";
import type { QueryResultRow } from "./pool.js";

export interface QueryExecutor {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export interface AuditLogInput {
  actorType: ActorType;
  actorId: string | null;
  targetType: string;
  targetId: string;
  command: string;
  reason: string;
  executionStatus: ExecutionStatus;
  mqttReasonCode: number | null;
  sessionId: string;
  commandId: string;
}

/** Audit_Log append-only insert. 제어 관련 호출부는 command 상태 변경과 같은 transaction에서 호출한다. */
export async function insertAuditLog(
  db: QueryExecutor,
  input: AuditLogInput,
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (
       actor_type, actor_id, target_type, target_id, command, reason,
       execution_status, mqtt_reason_code, session_id, command_id
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.actorType,
      input.actorId,
      input.targetType,
      input.targetId,
      input.command,
      input.reason,
      input.executionStatus,
      input.mqttReasonCode,
      input.sessionId,
      input.commandId,
    ],
  );
}
