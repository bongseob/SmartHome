import { isRetained, qosFor, type TopicSuffix } from "@smarthome/contracts";

/**
 * @smarthome/mqtt — mqtt.js 래퍼 (연결·LWT·공유구독·User Properties).
 * 현재는 스캐폴딩: suffix별 발행 옵션을 contracts 규칙에서 파생한다.
 * TODO: 실제 mqtt.js 클라이언트 팩토리 — docs/architecture.md §8.
 */
export interface PublishOptions {
  qos: 0 | 1 | 2;
  retain: boolean;
}

/** QoS·Retained 규칙(PROJECT_RULES §3)을 contracts에서 파생 — 하드코딩 금지 */
export function publishOptionsFor(suffix: TopicSuffix): PublishOptions {
  return { qos: qosFor(suffix), retain: isRetained(suffix) };
}
