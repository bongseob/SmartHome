import type { RecommendationStatus } from "./enums.js";

/**
 * AI 추천 상태 머신 (SRS 3.5, PROJECT_RULES §9 — command/alarm lifecycle.ts와 동일한 패턴).
 *
 *   PENDING_APPROVAL → APPROVED → EXECUTED
 *        │        │         └→ DISPATCH_FAILED → EXECUTED(재시도 성공) / DISPATCH_FAILED(재실패)
 *        │        └→ REJECTED
 *        └→ EXPIRED
 *
 * confidence≥임계치 이고 고위험 대상이 아니면(requiresHitl=false) PENDING_APPROVAL을 거치지
 * 않고 생성 시점에 바로 EXECUTED로 기록한다 — 이 상태 머신은 그 초기 기록에는 적용되지 않고,
 * PENDING_APPROVAL에서 시작하는 실제 승인 흐름의 전이만 검증한다.
 *
 * DISPATCH_FAILED(코드 리뷰 P1 #4): 승인 커밋(APPROVED)은 트랜잭션 안에서 끝나지만, 실제
 * MQTT 발행은 트랜잭션 밖의 별도 I/O라 실패할 수 있다 — 그 실패를 여기서 명시적 상태로
 * 남겨야 운영자가 재시도할 수 있고, 재시도도 실패하면 같은 상태에 머무른다(자기 자신으로의
 * 전이도 허용).
 *
 * DISPATCHING(코드 리뷰 P1-4): retryDispatch()의 원자적 claim 상태. DISPATCH_FAILED→DISPATCHING은
 * 조건부 UPDATE...WHERE status='DISPATCH_FAILED'로만 이뤄져(claimRecommendationForDispatch,
 * ai-repository.ts) 동시 재시도 중 하나만 성공한다. 발행 도중 프로세스가 죽어도 회수 유예 후
 * DISPATCHING→DISPATCHING 재-claim을 허용해 영구 고착을 막는다(자기 자신으로의 전이 허용).
 */
const ALLOWED_RECOMMENDATION_TRANSITIONS: Record<RecommendationStatus, readonly RecommendationStatus[]> = {
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "EXPIRED"],
  APPROVED: ["EXECUTED", "DISPATCH_FAILED"],
  DISPATCH_FAILED: ["EXECUTED", "DISPATCH_FAILED", "DISPATCHING"],
  DISPATCHING: ["EXECUTED", "DISPATCH_FAILED", "DISPATCHING"],
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
