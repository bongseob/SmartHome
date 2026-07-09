import { RecommendationType } from "@smarthome/contracts";

/**
 * @smarthome/ai-engine — 추천 생성 + HITL 게이트 (docs, SRS 3.5).
 * TODO: 이상행동/외출/취침/위험 추천, confidence·고위험 게이트, 학습데이터 적재.
 */
export function main(): void {
  console.log(
    `[ai-engine] 스캐폴딩 OK — 추천 유형=${RecommendationType.options.join(", ")}. 구현 예정.`,
  );
}

main();
