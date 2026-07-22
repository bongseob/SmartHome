import { describe, expect, it } from "vitest";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";
import { claimRecommendationForDispatch } from "./ai-repository.js";

const RECOMMENDATION_ID = "22222222-2222-2222-2222-222222222222";

function recommendationRow(status: string, claimedAt: Date | null): Record<string, unknown> {
  return {
    id: RECOMMENDATION_ID,
    type: "ENERGY_SAVING",
    target_type: "DEVICE",
    target_id: "33333333-3333-3333-3333-333333333333",
    proposed_command: "turn_off",
    proposed_payload: null,
    confidence_score: "0.9",
    requires_hitl: true,
    status,
    model_version: null,
    command_id: null,
    created_at: new Date("2026-07-20T00:00:00.000Z"),
    claimed_at: claimedAt,
  };
}

/** 실제 Postgres의 조건부 UPDATE...WHERE...RETURNING을, 상태를 기억하는 페이크 DB로 재현한다. */
class StatefulRecommendationDb implements QueryExecutor {
  status = "DISPATCH_FAILED";
  claimedAt: Date | null = null;

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    if (text.includes("UPDATE ai_recommendation") && text.includes("SET status = 'DISPATCHING'")) {
      const [, staleBefore, now] = params as [string, Date, Date];
      const eligible =
        this.status === "DISPATCH_FAILED" ||
        (this.status === "DISPATCHING" && this.claimedAt !== null && this.claimedAt < staleBefore);
      if (!eligible) {
        return { rows: [], rowCount: 0 };
      }
      this.status = "DISPATCHING";
      this.claimedAt = now;
      return { rows: [recommendationRow(this.status, this.claimedAt) as unknown as T], rowCount: 1 };
    }
    throw new Error(`unexpected query: ${text}`);
  }
}

describe("ai-repository — claimRecommendationForDispatch(코드 리뷰 P1-4)", () => {
  it("DISPATCH_FAILED 상태만 DISPATCHING으로 claim된다", async () => {
    const db = new StatefulRecommendationDb();
    const claimed = await claimRecommendationForDispatch(db, RECOMMENDATION_ID);

    expect(claimed?.status).toBe("DISPATCHING");
  });

  it("동시 재시도 두 건 중 한 건만 claim에 성공한다(중복 발행 방지)", async () => {
    const db = new StatefulRecommendationDb();

    const first = await claimRecommendationForDispatch(db, RECOMMENDATION_ID);
    const second = await claimRecommendationForDispatch(db, RECOMMENDATION_ID); // 동시 요청 시뮬레이션

    expect(first?.status).toBe("DISPATCHING");
    expect(second).toBeNull();
  });

  it("오래된 DISPATCHING claim(발행 도중 프로세스가 죽어 회수 안 된 경우)은 재-claim할 수 있다", async () => {
    const db = new StatefulRecommendationDb();
    db.status = "DISPATCHING";
    db.claimedAt = new Date(Date.now() - 10 * 60_000); // 10분 전 — 회수 유예(120초)를 넘김

    const reclaimed = await claimRecommendationForDispatch(db, RECOMMENDATION_ID);

    expect(reclaimed?.status).toBe("DISPATCHING");
  });

  it("최근 DISPATCHING claim(발행 진행 중일 수 있음)은 재-claim하지 않는다", async () => {
    const db = new StatefulRecommendationDb();
    db.status = "DISPATCHING";
    db.claimedAt = new Date(); // 방금 claim됨 — 아직 진행 중일 수 있음

    const reclaimed = await claimRecommendationForDispatch(db, RECOMMENDATION_ID);

    expect(reclaimed).toBeNull();
  });
});
