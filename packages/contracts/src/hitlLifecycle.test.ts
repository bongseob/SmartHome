import { describe, expect, it } from "vitest";
import {
  assertRecommendationTransition,
  canTransitionRecommendation,
  IllegalRecommendationTransitionError,
  nextRecommendationStates,
} from "./hitlLifecycle.js";

describe("AI 추천 상태 머신 (SRS 3.5)", () => {
  it("정상 경로: PENDING_APPROVAL→APPROVED→EXECUTED", () => {
    expect(canTransitionRecommendation("PENDING_APPROVAL", "APPROVED")).toBe(true);
    expect(canTransitionRecommendation("APPROVED", "EXECUTED")).toBe(true);
  });

  it("PENDING_APPROVAL→REJECTED, PENDING_APPROVAL→EXPIRED 허용", () => {
    expect(canTransitionRecommendation("PENDING_APPROVAL", "REJECTED")).toBe(true);
    expect(canTransitionRecommendation("PENDING_APPROVAL", "EXPIRED")).toBe(true);
  });

  it("APPROVED에서 REJECTED로는 못 간다(승인 후 거절 불가)", () => {
    expect(canTransitionRecommendation("APPROVED", "REJECTED")).toBe(false);
  });

  it("종결 상태(REJECTED/EXECUTED/EXPIRED)에서는 어떤 전이도 불가", () => {
    expect(nextRecommendationStates("REJECTED")).toEqual([]);
    expect(nextRecommendationStates("EXECUTED")).toEqual([]);
    expect(nextRecommendationStates("EXPIRED")).toEqual([]);
    expect(canTransitionRecommendation("EXECUTED", "APPROVED")).toBe(false);
  });

  it("PENDING_APPROVAL에서 바로 EXECUTED로는 못 간다(승인을 건너뛸 수 없다)", () => {
    expect(canTransitionRecommendation("PENDING_APPROVAL", "EXECUTED")).toBe(false);
  });

  it("assertRecommendationTransition은 불법 전이에 throw", () => {
    expect(() => assertRecommendationTransition("PENDING_APPROVAL", "APPROVED")).not.toThrow();
    expect(() => assertRecommendationTransition("REJECTED", "APPROVED")).toThrow(
      IllegalRecommendationTransitionError,
    );
  });

  describe("DISPATCH_FAILED 복구 경로(코드 리뷰 P1 #4)", () => {
    it("APPROVED→DISPATCH_FAILED 허용(승인 후 발행 실패)", () => {
      expect(canTransitionRecommendation("APPROVED", "DISPATCH_FAILED")).toBe(true);
    });

    it("DISPATCH_FAILED→EXECUTED 허용(재시도 성공)", () => {
      expect(canTransitionRecommendation("DISPATCH_FAILED", "EXECUTED")).toBe(true);
    });

    it("DISPATCH_FAILED→DISPATCH_FAILED 허용(재시도도 다시 실패)", () => {
      expect(canTransitionRecommendation("DISPATCH_FAILED", "DISPATCH_FAILED")).toBe(true);
    });

    it("DISPATCH_FAILED는 종결 상태가 아니다 — REJECTED 등으로는 못 간다", () => {
      expect(canTransitionRecommendation("DISPATCH_FAILED", "REJECTED")).toBe(false);
      expect(canTransitionRecommendation("DISPATCH_FAILED", "PENDING_APPROVAL")).toBe(false);
    });
  });
});
