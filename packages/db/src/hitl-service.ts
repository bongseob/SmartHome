import { assertRecommendationTransition, type ActorType, type HitlDecision } from "@smarthome/contracts";
import { withTransaction } from "./pool.js";
import { insertAuditLog, type QueryExecutor } from "./audit-repository.js";
import {
  insertAiTrainingSample,
  insertHitlDecision,
  lockRecommendationById,
  updateRecommendationStatus,
  type RecommendationRecord,
} from "./ai-repository.js";

export class RecommendationNotFoundError extends Error {
  constructor(public readonly recommendationId: string) {
    super(`recommendation not found: ${recommendationId}`);
    this.name = "RecommendationNotFoundError";
  }
}

export interface HitlDecisionInput {
  recommendationId: string;
  approverId: string | null;
  /** 승인/거절 이벤트 자체의 audit actorType(사람) — 승인 후 실제 제어 명령의 actorType은 항상 AI(PROJECT_RULES §9)로 별도 기록된다. */
  actorType: ActorType;
  decision: HitlDecision;
  reason?: string | null;
}

/**
 * HITL 승인/거절. 상태 전이(PENDING_APPROVAL→APPROVED/REJECTED) + hitl_decision +
 * ai_training_sample + audit_log를 하나의 transaction으로 묶는다
 * (SRS 3.5 "승인/거절은 모두 학습 데이터로 저장" — 누락 금지).
 * 실제 제어 명령 발행은 이 함수 밖(APPROVE 후 호출부)에서 command-flow로 수행하고,
 * markRecommendationExecuted로 마무리한다.
 */
export async function recordHitlDecision(input: HitlDecisionInput): Promise<RecommendationRecord> {
  return withTransaction((client) => recordHitlDecisionInTx(client, input));
}

export async function recordHitlDecisionInTx(
  db: QueryExecutor,
  input: HitlDecisionInput,
): Promise<RecommendationRecord> {
  const current = await lockRecommendationById(db, input.recommendationId);
  if (!current) {
    throw new RecommendationNotFoundError(input.recommendationId);
  }

  const toStatus = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
  assertRecommendationTransition(current.status, toStatus);

  const updated = await updateRecommendationStatus(db, input.recommendationId, toStatus);

  await insertHitlDecision(db, {
    recommendationId: input.recommendationId,
    approverId: input.approverId,
    decision: input.decision,
    reason: input.reason ?? null,
  });

  // 학습 데이터: 판단 시점 context 스냅샷(추천 자체의 내용) + 사람의 결정을 라벨로 저장.
  await insertAiTrainingSample(db, {
    recommendationId: input.recommendationId,
    context: {
      type: current.type,
      targetType: current.targetType,
      targetId: current.targetId,
      proposedCommand: current.proposedCommand,
      proposedPayload: current.proposedPayload,
      confidenceScore: current.confidenceScore,
      requiresHitl: current.requiresHitl,
      modelVersion: current.modelVersion,
    },
    decision: input.decision,
  });

  await insertAuditLog(db, {
    actorType: input.actorType,
    actorId: input.approverId,
    targetType: "AI_RECOMMENDATION",
    targetId: input.recommendationId,
    command: input.decision === "APPROVE" ? "HITL_APPROVE" : "HITL_REJECT",
    reason: input.reason?.trim() || `hitl ${input.decision.toLowerCase()}`,
    executionStatus: "SUCCEEDED",
    mqttReasonCode: null,
    sessionId: null,
    commandId: null,
  });

  return updated;
}

/** 승인된 추천의 실제 명령 발행이 끝난 뒤 APPROVED→EXECUTED로 마무리한다. */
export async function markRecommendationExecuted(
  db: QueryExecutor,
  recommendationId: string,
  commandId: string,
): Promise<RecommendationRecord> {
  const current = await lockRecommendationById(db, recommendationId);
  if (!current) {
    throw new RecommendationNotFoundError(recommendationId);
  }
  assertRecommendationTransition(current.status, "EXECUTED");
  return updateRecommendationStatus(db, recommendationId, "EXECUTED", commandId);
}
