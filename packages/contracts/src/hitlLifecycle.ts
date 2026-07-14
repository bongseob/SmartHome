import type { RecommendationStatus } from "./enums.js";

/**
 * AI 추천 상태 머신 (SRS 3.5, PROJECT_RULES §9 — command/alarm lifecycle.ts와 동일한 패턴).
 *
 *   PENDING_APPROVAL → APPROVED → EXECUTED
 *        │        └→ REJECTED
 *        └→ EXPIRED
 *
 * confidence≥임계치 이고 고위험 대상이 아니면(requiresHitl=false) PENDING_APPROVAL을 거치지
 * 않고 생성 시점에 바로 EXECUTED로 기록한다 — 이 상태 머신은 그 초기 기록에는 적용되지 않고,
 * PENDING_APPROVAL에서 시작하는 실제 승인 흐름의 전이만 검증한다.
 */
const ALLOWED_RECOMMENDATION_TRANSITIONS: Record<RecommendationStatus, readonly RecommendationStatus[]> = {
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "EXPIRED"],
  APPROVED: ["EXECUTED"],
  REJECTED: [],
  EXECUTED: [],
  EXPIRED: [],
};

export function nextRecommendationStates(from: RecommendationStatus): readonly RecommendationStatus[] {
  return ALLOWED_RECOMMENDATION_TRANSITIONS[from] ?? [];
}

export function canTransitionRecommendation(from: RecommendationStatus, to: RecommendationStatus): boolean {
  return nextRecommendationStates(from).includes(to);
}

export class IllegalRecommendationTransitionError extends Error {
  constructor(
    public readonly from: RecommendationStatus,
    public readonly to: RecommendationStatus,
  ) {
    super(`허용되지 않은 AI 추천 상태 전이: ${from} → ${to}`);
    this.name = "IllegalRecommendationTransitionError";
  }
}

/** 전이가 불법이면 throw. 호출부는 성공 시 Audit_Log 기록을 동일 트랜잭션으로 수행한다. */
export function assertRecommendationTransition(from: RecommendationStatus, to: RecommendationStatus): void {
  if (!canTransitionRecommendation(from, to)) {
    throw new IllegalRecommendationTransitionError(from, to);
  }
}
