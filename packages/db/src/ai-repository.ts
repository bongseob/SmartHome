import type { HitlDecision, RecommendationStatus, RecommendationType, TargetType } from "@smarthome/contracts";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";

// ─── AI Recommendation (SRS 3.5, docs/erd.md G) ──────────────────────────

export interface RecommendationRecord {
  id: string;
  type: RecommendationType;
  targetType: TargetType;
  targetId: string;
  proposedCommand: string;
  proposedPayload: unknown;
  confidenceScore: number;
  requiresHitl: boolean;
  status: RecommendationStatus;
  modelVersion: string | null;
  commandId: string | null;
  createdAt: Date;
}

interface RecommendationRow extends QueryResultRow {
  id: string;
  type: RecommendationType;
  target_type: TargetType;
  target_id: string;
  proposed_command: string;
  proposed_payload: unknown;
  confidence_score: string;
  requires_hitl: boolean;
  status: RecommendationStatus;
  model_version: string | null;
  command_id: string | null;
  created_at: Date;
}

const RECOMMENDATION_COLUMNS = `
  id::text, type, target_type, target_id::text, proposed_command, proposed_payload,
  confidence_score::text, requires_hitl, status, model_version, command_id, created_at
`;

function toRecommendation(row: RecommendationRow): RecommendationRecord {
  return {
    id: row.id,
    type: row.type,
    targetType: row.target_type,
    targetId: row.target_id,
    proposedCommand: row.proposed_command,
    proposedPayload: row.proposed_payload,
    confidenceScore: Number(row.confidence_score),
    requiresHitl: row.requires_hitl,
    status: row.status,
    modelVersion: row.model_version,
    commandId: row.command_id,
    createdAt: row.created_at,
  };
}

export interface CreateRecommendationInput {
  type: RecommendationType;
  targetType: TargetType;
  targetId: string;
  proposedCommand: string;
  proposedPayload?: unknown;
  confidenceScore: number;
  requiresHitl: boolean;
  /** requiresHitl=false면 생성 시점에 이미 발행된 command의 id(즉시 EXECUTED 기록용). */
  status: RecommendationStatus;
  commandId?: string | null;
  modelVersion?: string | null;
}

export async function createRecommendation(
  db: QueryExecutor,
  input: CreateRecommendationInput,
): Promise<RecommendationRecord> {
  const r = await db.query<RecommendationRow>(
    `INSERT INTO ai_recommendation (
       type, target_type, target_id, proposed_command, proposed_payload,
       confidence_score, requires_hitl, status, model_version, command_id
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING ${RECOMMENDATION_COLUMNS}`,
    [
      input.type,
      input.targetType,
      input.targetId,
      input.proposedCommand,
      input.proposedPayload === undefined ? null : JSON.stringify(input.proposedPayload),
      input.confidenceScore,
      input.requiresHitl,
      input.status,
      input.modelVersion ?? null,
      input.commandId ?? null,
    ],
  );
  return toRecommendation(r.rows[0]!);
}

export async function getRecommendation(db: QueryExecutor, id: string): Promise<RecommendationRecord | null> {
  const r = await db.query<RecommendationRow>(
    `SELECT ${RECOMMENDATION_COLUMNS} FROM ai_recommendation WHERE id::text = $1`,
    [id],
  );
  const row = r.rows[0];
  return row ? toRecommendation(row) : null;
}

/** 승인/거절 처리 중 동시 갱신을 막기 위한 잠금 조회(hitl-service.ts에서만 사용). */
export async function lockRecommendationById(db: QueryExecutor, id: string): Promise<RecommendationRecord | null> {
  const r = await db.query<RecommendationRow>(
    `SELECT ${RECOMMENDATION_COLUMNS} FROM ai_recommendation WHERE id::text = $1 FOR UPDATE`,
    [id],
  );
  const row = r.rows[0];
  return row ? toRecommendation(row) : null;
}

export interface RecommendationListFilter {
  status?: RecommendationStatus;
}

export async function listRecommendations(
  db: QueryExecutor,
  filter: RecommendationListFilter = {},
): Promise<RecommendationRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const r = await db.query<RecommendationRow>(
    `SELECT ${RECOMMENDATION_COLUMNS} FROM ai_recommendation ${where} ORDER BY created_at DESC`,
    params,
  );
  return r.rows.map(toRecommendation);
}

export async function updateRecommendationStatus(
  db: QueryExecutor,
  id: string,
  status: RecommendationStatus,
  commandId?: string | null,
): Promise<RecommendationRecord> {
  const r = await db.query<RecommendationRow>(
    `UPDATE ai_recommendation
     SET status = $2, command_id = COALESCE($3, command_id)
     WHERE id::text = $1
     RETURNING ${RECOMMENDATION_COLUMNS}`,
    [id, status, commandId ?? null],
  );
  return toRecommendation(r.rows[0]!);
}

// ─── HITL Decision + 학습 데이터 (SRS 3.5 — "승인/거절은 모두 학습 데이터로 저장") ────

export interface InsertHitlDecisionInput {
  recommendationId: string;
  approverId: string | null;
  decision: HitlDecision;
  reason?: string | null;
}

export async function insertHitlDecision(db: QueryExecutor, input: InsertHitlDecisionInput): Promise<void> {
  await db.query(
    `INSERT INTO hitl_decision (recommendation_id, approver_id, decision, reason)
     VALUES ($1,$2,$3,$4)`,
    [input.recommendationId, input.approverId, input.decision, input.reason ?? null],
  );
}

export interface InsertAiTrainingSampleInput {
  recommendationId: string;
  context: unknown;
  decision: HitlDecision;
}

export async function insertAiTrainingSample(db: QueryExecutor, input: InsertAiTrainingSampleInput): Promise<void> {
  await db.query(
    `INSERT INTO ai_training_sample (recommendation_id, context, decision)
     VALUES ($1,$2,$3)`,
    [input.recommendationId, JSON.stringify(input.context), input.decision],
  );
}
