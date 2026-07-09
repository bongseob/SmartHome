import type { ActorType, ExecutionStatus, TargetType } from "@smarthome/contracts";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";

export interface CommandRecord {
  commandId: string;
  sessionId: string;
  actorType: ActorType;
  actorId: string | null;
  role: string | null;
  targetType: TargetType;
  targetId: string;
  command: string;
  payload: unknown;
  status: ExecutionStatus;
  mqttReasonCode: number | null;
}

export interface CreateCommandInput {
  commandId: string;
  sessionId: string;
  actorType: ActorType;
  actorId: string | null;
  role: string | null;
  targetType: TargetType;
  targetId: string;
  command: string;
  payload: unknown;
}

export interface CreateCommandResult {
  command: CommandRecord;
  inserted: boolean;
}

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

function toCommandRecord(row: CommandRow): CommandRecord {
  return {
    commandId: row.command_id,
    sessionId: row.session_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    role: row.role,
    targetType: row.target_type,
    targetId: row.target_id,
    command: row.command,
    payload: row.payload,
    status: row.status,
    mqttReasonCode: row.mqtt_reason_code,
  };
}

const COMMAND_COLUMNS = `
  command_id, session_id, actor_type, actor_id, role, target_type, target_id,
  command, payload, status, mqtt_reason_code
`;

export async function getCommandById(
  db: QueryExecutor,
  commandId: string,
): Promise<CommandRecord | null> {
  const r = await db.query<CommandRow>(
    `SELECT ${COMMAND_COLUMNS} FROM command WHERE command_id = $1`,
    [commandId],
  );
  const row = r.rows[0];
  return row ? toCommandRecord(row) : null;
}

export async function lockCommandById(
  db: QueryExecutor,
  commandId: string,
): Promise<CommandRecord | null> {
  const r = await db.query<CommandRow>(
    `SELECT ${COMMAND_COLUMNS} FROM command WHERE command_id = $1 FOR UPDATE`,
    [commandId],
  );
  const row = r.rows[0];
  return row ? toCommandRecord(row) : null;
}

/**
 * commandId는 멱등성 키다. 이미 존재하면 새 row/audit를 만들지 않고 기존 row를 반환한다.
 */
export async function insertCommandCreated(
  db: QueryExecutor,
  input: CreateCommandInput,
): Promise<CreateCommandResult> {
  const inserted = await db.query<CommandRow>(
    `INSERT INTO command (
       command_id, session_id, actor_type, actor_id, role, target_type, target_id,
       command, payload, status
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'CREATED')
     ON CONFLICT (command_id) DO NOTHING
     RETURNING ${COMMAND_COLUMNS}`,
    [
      input.commandId,
      input.sessionId,
      input.actorType,
      input.actorId,
      input.role,
      input.targetType,
      input.targetId,
      input.command,
      input.payload,
    ],
  );
  const insertedRow = inserted.rows[0];
  if (insertedRow) {
    return { command: toCommandRecord(insertedRow), inserted: true };
  }

  const existing = await getCommandById(db, input.commandId);
  if (!existing) {
    throw new Error(`command insert conflict resolved without existing row: ${input.commandId}`);
  }
  return { command: existing, inserted: false };
}

export async function updateCommandStatus(
  db: QueryExecutor,
  commandId: string,
  status: ExecutionStatus,
  mqttReasonCode: number | null,
): Promise<CommandRecord> {
  const r = await db.query<CommandRow>(
    `UPDATE command
     SET status = $2, mqtt_reason_code = $3, updated_at = now()
     WHERE command_id = $1
     RETURNING ${COMMAND_COLUMNS}`,
    [commandId, status, mqttReasonCode],
  );
  const row = r.rows[0];
  if (!row) {
    throw new Error(`command not found: ${commandId}`);
  }
  return toCommandRecord(row);
}
