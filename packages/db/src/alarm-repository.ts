import type { AlarmActionType, AlarmState, AlarmTier, ChannelType, Role, Severity, TargetType } from "@smarthome/contracts";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";

// ─── Alarm Policy ───────────────────────────────────────────────────────

export interface AlarmPolicyRecord {
  id: string;
  name: string;
  tier: AlarmTier;
  targetType: TargetType;
  targetId: string | null;
  metric: string | null;
  operator: string | null;
  thresholdValue: number | null;
  durationSec: number | null;
  severity: Severity;
  enabled: boolean;
}

interface AlarmPolicyRow extends QueryResultRow {
  id: string;
  name: string;
  tier: AlarmTier;
  target_type: TargetType;
  target_id: string | null;
  metric: string | null;
  operator: string | null;
  threshold_value: string | null;
  duration_sec: number | null;
  severity: Severity;
  enabled: boolean;
}

function toAlarmPolicy(row: AlarmPolicyRow): AlarmPolicyRecord {
  return {
    id: row.id,
    name: row.name,
    tier: row.tier,
    targetType: row.target_type,
    targetId: row.target_id,
    metric: row.metric,
    operator: row.operator,
    thresholdValue: row.threshold_value === null ? null : Number(row.threshold_value),
    durationSec: row.duration_sec,
    severity: row.severity,
    enabled: row.enabled,
  };
}

const THRESHOLD_OPERATORS: Record<string, (value: number, threshold: number) => boolean> = {
  ">": (v, t) => v > t,
  ">=": (v, t) => v >= t,
  "<": (v, t) => v < t,
  "<=": (v, t) => v <= t,
  "==": (v, t) => v === t,
  "!=": (v, t) => v !== t,
};

/** 알 수 없는 operator 문자열은 false — 잘못 설정된 정책이 오탐으로 알람을 올리지 않게 한다. */
export function compareThreshold(operator: string, value: number, threshold: number): boolean {
  return THRESHOLD_OPERATORS[operator]?.(value, threshold) ?? false;
}

const ALARM_POLICY_COLUMNS = `
  id::text, name, tier, target_type, target_id::text, metric, operator,
  threshold_value::text, duration_sec, severity, enabled
`;

export interface CreateAlarmPolicyInput {
  name: string;
  tier: AlarmTier;
  targetType: TargetType;
  targetId?: string | null;
  metric?: string | null;
  operator?: string | null;
  thresholdValue?: number | null;
  durationSec?: number | null;
  severity: Severity;
  createdBy?: string | null;
}

export async function createAlarmPolicy(
  db: QueryExecutor,
  input: CreateAlarmPolicyInput,
): Promise<AlarmPolicyRecord> {
  const r = await db.query<AlarmPolicyRow>(
    `INSERT INTO alarm_policy (
       name, tier, target_type, target_id, metric, operator, threshold_value,
       duration_sec, severity, created_by
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING ${ALARM_POLICY_COLUMNS}`,
    [
      input.name,
      input.tier,
      input.targetType,
      input.targetId ?? null,
      input.metric ?? null,
      input.operator ?? null,
      input.thresholdValue ?? null,
      input.durationSec ?? null,
      input.severity,
      input.createdBy ?? null,
    ],
  );
  const row = r.rows[0];
  if (!row) throw new Error("alarm_policy insert did not return a row");
  return toAlarmPolicy(row);
}

export interface AlarmPolicyFilter {
  enabled?: boolean;
  targetType?: TargetType;
}

export async function listAlarmPolicies(
  db: QueryExecutor,
  filter: AlarmPolicyFilter = {},
): Promise<AlarmPolicyRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.enabled !== undefined) {
    params.push(filter.enabled);
    conditions.push(`enabled = $${params.length}`);
  }
  if (filter.targetType) {
    params.push(filter.targetType);
    conditions.push(`target_type = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const r = await db.query<AlarmPolicyRow>(
    `SELECT ${ALARM_POLICY_COLUMNS} FROM alarm_policy ${where} ORDER BY name`,
    params,
  );
  return r.rows.map(toAlarmPolicy);
}

export async function getAlarmPolicyById(
  db: QueryExecutor,
  id: string,
): Promise<AlarmPolicyRecord | null> {
  const r = await db.query<AlarmPolicyRow>(
    `SELECT ${ALARM_POLICY_COLUMNS} FROM alarm_policy WHERE id::text = $1`,
    [id],
  );
  const row = r.rows[0];
  return row ? toAlarmPolicy(row) : null;
}

export async function setAlarmPolicyEnabled(
  db: QueryExecutor,
  id: string,
  enabled: boolean,
): Promise<AlarmPolicyRecord | null> {
  const r = await db.query<AlarmPolicyRow>(
    `UPDATE alarm_policy SET enabled = $2 WHERE id::text = $1 RETURNING ${ALARM_POLICY_COLUMNS}`,
    [id, enabled],
  );
  const row = r.rows[0];
  return row ? toAlarmPolicy(row) : null;
}

// ─── Notification Channel ───────────────────────────────────────────────

export interface NotificationChannelRecord {
  id: string;
  type: ChannelType;
  name: string;
  config: unknown;
}

interface NotificationChannelRow extends QueryResultRow {
  id: string;
  type: ChannelType;
  name: string;
  config: unknown;
}

function toNotificationChannel(row: NotificationChannelRow): NotificationChannelRecord {
  return { id: row.id, type: row.type, name: row.name, config: row.config };
}

export async function createNotificationChannel(
  db: QueryExecutor,
  input: { type: ChannelType; name: string; config: unknown },
): Promise<NotificationChannelRecord> {
  const r = await db.query<NotificationChannelRow>(
    `INSERT INTO notification_channel (type, name, config)
     VALUES ($1,$2,$3)
     RETURNING id::text, type, name, config`,
    [input.type, input.name, JSON.stringify(input.config ?? {})],
  );
  const row = r.rows[0];
  if (!row) throw new Error("notification_channel insert did not return a row");
  return toNotificationChannel(row);
}

export async function getNotificationChannelById(
  db: QueryExecutor,
  id: string,
): Promise<NotificationChannelRecord | null> {
  const r = await db.query<NotificationChannelRow>(
    `SELECT id::text, type, name, config FROM notification_channel WHERE id::text = $1`,
    [id],
  );
  const row = r.rows[0];
  return row ? toNotificationChannel(row) : null;
}

export async function listNotificationChannels(db: QueryExecutor): Promise<NotificationChannelRecord[]> {
  const r = await db.query<NotificationChannelRow>(
    `SELECT id::text, type, name, config FROM notification_channel ORDER BY name`,
  );
  return r.rows.map(toNotificationChannel);
}

export async function linkPolicyChannel(
  db: QueryExecutor,
  policyId: string,
  channelId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO alarm_policy_channel (policy_id, channel_id) VALUES ($1,$2)
     ON CONFLICT DO NOTHING`,
    [policyId, channelId],
  );
}

export async function listChannelsForPolicy(
  db: QueryExecutor,
  policyId: string,
): Promise<NotificationChannelRecord[]> {
  const r = await db.query<NotificationChannelRow>(
    `SELECT nc.id::text, nc.type, nc.name, nc.config
     FROM notification_channel nc
     JOIN alarm_policy_channel apc ON apc.channel_id = nc.id
     WHERE apc.policy_id::text = $1`,
    [policyId],
  );
  return r.rows.map(toNotificationChannel);
}

// ─── Escalation Rule ─────────────────────────────────────────────────────

export interface EscalationRuleRecord {
  id: string;
  policyId: string;
  level: number;
  afterSec: number;
  notifyChannelId: string | null;
  notifyRole: Role | null;
}

interface EscalationRuleRow extends QueryResultRow {
  id: string;
  policy_id: string;
  level: number;
  after_sec: number;
  notify_channel_id: string | null;
  notify_role: Role | null;
}

function toEscalationRule(row: EscalationRuleRow): EscalationRuleRecord {
  return {
    id: row.id,
    policyId: row.policy_id,
    level: row.level,
    afterSec: row.after_sec,
    notifyChannelId: row.notify_channel_id,
    notifyRole: row.notify_role,
  };
}

export async function createEscalationRule(
  db: QueryExecutor,
  input: { policyId: string; level: number; afterSec: number; notifyChannelId?: string | null; notifyRole?: Role | null },
): Promise<EscalationRuleRecord> {
  const r = await db.query<EscalationRuleRow>(
    `INSERT INTO escalation_rule (policy_id, level, after_sec, notify_channel_id, notify_role)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id::text, policy_id::text, level, after_sec, notify_channel_id::text, notify_role`,
    [input.policyId, input.level, input.afterSec, input.notifyChannelId ?? null, input.notifyRole ?? null],
  );
  const row = r.rows[0];
  if (!row) throw new Error("escalation_rule insert did not return a row");
  return toEscalationRule(row);
}

export async function listEscalationRulesForPolicy(
  db: QueryExecutor,
  policyId: string,
): Promise<EscalationRuleRecord[]> {
  const r = await db.query<EscalationRuleRow>(
    `SELECT id::text, policy_id::text, level, after_sec, notify_channel_id::text, notify_role
     FROM escalation_rule WHERE policy_id::text = $1 ORDER BY level`,
    [policyId],
  );
  return r.rows.map(toEscalationRule);
}

// ─── Alarm Log ───────────────────────────────────────────────────────────

export interface AlarmRecord {
  id: string;
  policyId: string | null;
  deviceId: string | null;
  tier: AlarmTier;
  severity: Severity;
  message: string | null;
  state: AlarmState;
  raisedAt: Date;
  snoozedUntil: Date | null;
  resolvedAt: Date | null;
  escalatedLevel: number;
}

interface AlarmRow extends QueryResultRow {
  id: string;
  policy_id: string | null;
  device_id: string | null;
  tier: AlarmTier;
  severity: Severity;
  message: string | null;
  state: AlarmState;
  raised_at: Date;
  snoozed_until: Date | null;
  resolved_at: Date | null;
  escalated_level: number;
}

function toAlarmRecord(row: AlarmRow): AlarmRecord {
  return {
    id: row.id,
    policyId: row.policy_id,
    deviceId: row.device_id,
    tier: row.tier,
    severity: row.severity,
    message: row.message,
    state: row.state,
    raisedAt: row.raised_at,
    snoozedUntil: row.snoozed_until,
    resolvedAt: row.resolved_at,
    escalatedLevel: row.escalated_level,
  };
}

const ALARM_LOG_COLUMNS = `
  id::text, policy_id::text, device_id::text, tier, severity, message, state,
  raised_at, snoozed_until, resolved_at, escalated_level
`;

/** 동일 policy+device로 이미 열려 있는(RAISED/ACK/SNOOZED) 알람이 있으면 재발행하지 않는다(중복 억제). */
export async function findOpenAlarm(
  db: QueryExecutor,
  policyId: string,
  deviceId: string,
): Promise<AlarmRecord | null> {
  const r = await db.query<AlarmRow>(
    `SELECT ${ALARM_LOG_COLUMNS} FROM alarm_log
     WHERE policy_id::text = $1 AND device_id::text = $2 AND state IN ('RAISED','ACK','SNOOZED')
     ORDER BY raised_at DESC LIMIT 1`,
    [policyId, deviceId],
  );
  const row = r.rows[0];
  return row ? toAlarmRecord(row) : null;
}

export async function insertAlarmLog(
  db: QueryExecutor,
  input: { policyId: string | null; deviceId: string | null; tier: AlarmTier; severity: Severity; message: string | null },
): Promise<AlarmRecord> {
  const r = await db.query<AlarmRow>(
    `INSERT INTO alarm_log (policy_id, device_id, tier, severity, message, state)
     VALUES ($1,$2,$3,$4,$5,'RAISED')
     RETURNING ${ALARM_LOG_COLUMNS}`,
    [input.policyId, input.deviceId, input.tier, input.severity, input.message],
  );
  const row = r.rows[0];
  if (!row) throw new Error("alarm_log insert did not return a row");
  return toAlarmRecord(row);
}

export async function getAlarmById(db: QueryExecutor, id: string): Promise<AlarmRecord | null> {
  const r = await db.query<AlarmRow>(`SELECT ${ALARM_LOG_COLUMNS} FROM alarm_log WHERE id::text = $1`, [id]);
  const row = r.rows[0];
  return row ? toAlarmRecord(row) : null;
}

export async function lockAlarmById(db: QueryExecutor, id: string): Promise<AlarmRecord | null> {
  const r = await db.query<AlarmRow>(
    `SELECT ${ALARM_LOG_COLUMNS} FROM alarm_log WHERE id::text = $1 FOR UPDATE`,
    [id],
  );
  const row = r.rows[0];
  return row ? toAlarmRecord(row) : null;
}

export interface AlarmListFilter {
  state?: AlarmState;
  tier?: AlarmTier;
  severity?: Severity;
  deviceId?: string;
}

/** 기기의 area 소속을 함께 내려줘 API 레이어에서 area 스코프 필터링에 쓴다. */
export interface AlarmWithAreaRow extends AlarmRecord {
  areaTopicPrefix: string | null;
}

export async function listAlarms(
  db: QueryExecutor,
  filter: AlarmListFilter = {},
  limit = 50,
): Promise<AlarmWithAreaRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.state) {
    params.push(filter.state);
    conditions.push(`al.state = $${params.length}`);
  }
  if (filter.tier) {
    params.push(filter.tier);
    conditions.push(`al.tier = $${params.length}`);
  }
  if (filter.severity) {
    params.push(filter.severity);
    conditions.push(`al.severity = $${params.length}`);
  }
  if (filter.deviceId) {
    params.push(filter.deviceId);
    conditions.push(`al.device_id::text = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  const r = await db.query<AlarmRow & { area_topic_prefix: string | null }>(
    `SELECT al.id::text, al.policy_id::text, al.device_id::text, al.tier, al.severity, al.message,
            al.state, al.raised_at, al.snoozed_until, al.resolved_at, al.escalated_level,
            CASE WHEN a.id IS NOT NULL THEN
              CONCAT('enterprise/', s.slug, '/', b.slug, '/', f.slug, '/', a.slug)
            ELSE NULL END AS area_topic_prefix
     FROM alarm_log al
     LEFT JOIN device d     ON d.id = al.device_id
     LEFT JOIN area a       ON a.id = d.area_id
     LEFT JOIN floor f      ON f.id = a.floor_id
     LEFT JOIN building b   ON b.id = f.building_id
     LEFT JOIN site s       ON s.id = b.site_id
     ${where}
     ORDER BY al.raised_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return r.rows.map((row) => ({ ...toAlarmRecord(row), areaTopicPrefix: row.area_topic_prefix }));
}

export async function getAlarmWithAreaScope(
  db: QueryExecutor,
  id: string,
): Promise<AlarmWithAreaRow | null> {
  const r = await db.query<AlarmRow & { area_topic_prefix: string | null }>(
    `SELECT al.id::text, al.policy_id::text, al.device_id::text, al.tier, al.severity, al.message,
            al.state, al.raised_at, al.snoozed_until, al.resolved_at, al.escalated_level,
            CASE WHEN a.id IS NOT NULL THEN
              CONCAT('enterprise/', s.slug, '/', b.slug, '/', f.slug, '/', a.slug)
            ELSE NULL END AS area_topic_prefix
     FROM alarm_log al
     LEFT JOIN device d     ON d.id = al.device_id
     LEFT JOIN area a       ON a.id = d.area_id
     LEFT JOIN floor f      ON f.id = a.floor_id
     LEFT JOIN building b   ON b.id = f.building_id
     LEFT JOIN site s       ON s.id = b.site_id
     WHERE al.id::text = $1`,
    [id],
  );
  const row = r.rows[0];
  return row ? { ...toAlarmRecord(row), areaTopicPrefix: row.area_topic_prefix } : null;
}

export interface UpdateAlarmStatePatch {
  state: AlarmState;
  snoozedUntil?: Date | null;
  resolvedAt?: Date | null;
  escalatedLevel?: number;
}

/** 에스컬레이션 sweep 전용 — 상태는 건드리지 않고 진행 레벨만 올린다. */
export async function bumpEscalatedLevel(db: QueryExecutor, id: string, level: number): Promise<void> {
  await db.query(`UPDATE alarm_log SET escalated_level = $2 WHERE id::text = $1`, [id, level]);
}

export async function updateAlarmState(
  db: QueryExecutor,
  id: string,
  patch: UpdateAlarmStatePatch,
): Promise<AlarmRecord> {
  const r = await db.query<AlarmRow>(
    `UPDATE alarm_log
     SET state = $2,
         snoozed_until = COALESCE($3, snoozed_until),
         resolved_at = COALESCE($4, resolved_at),
         escalated_level = COALESCE($5, escalated_level)
     WHERE id::text = $1
     RETURNING ${ALARM_LOG_COLUMNS}`,
    [id, patch.state, patch.snoozedUntil ?? null, patch.resolvedAt ?? null, patch.escalatedLevel ?? null],
  );
  const row = r.rows[0];
  if (!row) throw new Error(`alarm_log not found: ${id}`);
  return toAlarmRecord(row);
}

// ─── Alarm Action ────────────────────────────────────────────────────────

export async function insertAlarmAction(
  db: QueryExecutor,
  input: { alarmId: string; actorId: string | null; actionType: AlarmActionType; note: string | null },
): Promise<void> {
  await db.query(
    `INSERT INTO alarm_action (alarm_id, actor_id, action_type, note)
     VALUES ($1,$2,$3,$4)`,
    [input.alarmId, input.actorId, input.actionType, input.note],
  );
}

// ─── Escalation sweep ────────────────────────────────────────────────────

export interface DueEscalation {
  alarm: AlarmRecord;
  ruleId: string;
  level: number;
  notifyChannelId: string | null;
  notifyRole: Role | null;
}

interface DueEscalationRow extends AlarmRow {
  rule_id: string;
  level: number;
  notify_channel_id: string | null;
  notify_role: Role | null;
}

/**
 * 알람별로 아직 발동하지 않은(escalated_level 미만) 레벨 중 after_sec가 지난 가장 낮은 레벨 1건만 반환한다.
 * SNOOZED는 snoozed_until이 지났을 때만(스누즈 해제) 에스컬레이션 대상에 포함한다.
 */
export async function listDueEscalations(db: QueryExecutor, now: Date): Promise<DueEscalation[]> {
  const r = await db.query<DueEscalationRow>(
    `SELECT DISTINCT ON (al.id)
       al.id::text, al.policy_id::text, al.device_id::text, al.tier, al.severity, al.message,
       al.state, al.raised_at, al.snoozed_until, al.resolved_at, al.escalated_level,
       er.id::text AS rule_id, er.level, er.notify_channel_id::text, er.notify_role
     FROM alarm_log al
     JOIN escalation_rule er ON er.policy_id = al.policy_id
     WHERE (al.state IN ('RAISED','ACK') OR (al.state = 'SNOOZED' AND al.snoozed_until <= $1))
       AND er.level > al.escalated_level
       AND al.raised_at + (er.after_sec * interval '1 second') <= $1
     ORDER BY al.id, er.level ASC`,
    [now],
  );
  return r.rows.map((row) => ({
    alarm: toAlarmRecord(row),
    ruleId: row.rule_id,
    level: row.level,
    notifyChannelId: row.notify_channel_id,
    notifyRole: row.notify_role,
  }));
}
