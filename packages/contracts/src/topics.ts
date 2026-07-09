/**
 * UNS 토픽 단일 소스 (PROJECT_RULES §2, docs/mqtt-topic-design.md §1).
 *
 *   enterprise/{site}/{building}/{floor}/{area}/{device}/{suffix}
 *
 * 토픽 문자열은 절대 하드코딩하지 말고 buildTopic()으로만 생성한다.
 */

export const UNS_ROOT = "enterprise" as const;

/** 세그먼트 규칙: 소문자 kebab-case, 공백·슬래시·+·# 금지 */
export const SEGMENT_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const TOPIC_SUFFIXES = [
  "state",
  "telemetry",
  "cmd",
  "cmd/ack",
  "alarm",
] as const;
export type TopicSuffix = (typeof TOPIC_SUFFIXES)[number];

/** QoS 매핑 (SRS 4.1.1 — 위반 금지) */
export const QOS_BY_SUFFIX: Record<TopicSuffix, 0 | 1 | 2> = {
  state: 1,
  telemetry: 0,
  cmd: 1,
  "cmd/ack": 1,
  alarm: 2,
};

/** Retained 는 state 토픽만 (PROJECT_RULES §3.3) */
export const RETAINED_SUFFIXES: ReadonlySet<TopicSuffix> = new Set(["state"]);

export interface TopicParts {
  site: string;
  building: string;
  floor: string;
  area: string;
  device: string;
  suffix: TopicSuffix;
}

export class InvalidTopicSegmentError extends Error {
  constructor(
    public readonly field: string,
    public readonly value: string,
  ) {
    super(`잘못된 UNS 토픽 세그먼트 '${field}'='${value}' (패턴 ${SEGMENT_PATTERN})`);
    this.name = "InvalidTopicSegmentError";
  }
}

function assertSegment(field: string, value: string): void {
  if (!SEGMENT_PATTERN.test(value)) {
    throw new InvalidTopicSegmentError(field, value);
  }
}

/** UNS 토픽 생성 + 세그먼트 검증 */
export function buildTopic(parts: TopicParts): string {
  assertSegment("site", parts.site);
  assertSegment("building", parts.building);
  assertSegment("floor", parts.floor);
  assertSegment("area", parts.area);
  assertSegment("device", parts.device);
  return [
    UNS_ROOT,
    parts.site,
    parts.building,
    parts.floor,
    parts.area,
    parts.device,
    parts.suffix,
  ].join("/");
}

/** 기기 베이스 토픽(suffix 제외) — ACL/구독 프리픽스용 */
export function buildDeviceBase(
  parts: Omit<TopicParts, "suffix">,
): string {
  assertSegment("site", parts.site);
  assertSegment("building", parts.building);
  assertSegment("floor", parts.floor);
  assertSegment("area", parts.area);
  assertSegment("device", parts.device);
  return [UNS_ROOT, parts.site, parts.building, parts.floor, parts.area, parts.device].join("/");
}

export function buildEnterpriseAclTopic(): string {
  return `${UNS_ROOT}/#`;
}

export function buildAreaAclTopic(parts: Omit<TopicParts, "device" | "suffix">): string {
  assertSegment("site", parts.site);
  assertSegment("building", parts.building);
  assertSegment("floor", parts.floor);
  assertSegment("area", parts.area);
  return [UNS_ROOT, parts.site, parts.building, parts.floor, parts.area, "#"].join("/");
}

/**
 * UNS 토픽을 세그먼트로 분해한다. 형식이 맞지 않으면 null.
 * (gateway 등 수신측이 토픽에서 device/suffix를 추출할 때 사용)
 */
export function parseTopic(topic: string): TopicParts | null {
  const segs = topic.split("/");
  if (segs.length < 7) return null;
  const root = segs[0];
  const site = segs[1];
  const building = segs[2];
  const floor = segs[3];
  const area = segs[4];
  const device = segs[5];
  const rest = segs.slice(6);
  if (!root || !site || !building || !floor || !area || !device) return null;
  if (root !== UNS_ROOT) return null;
  const suffix = rest.join("/");
  if (!(TOPIC_SUFFIXES as readonly string[]).includes(suffix)) return null;
  for (const seg of [site, building, floor, area, device]) {
    if (!SEGMENT_PATTERN.test(seg)) return null;
  }
  return {
    site,
    building,
    floor,
    area,
    device,
    suffix: suffix as TopicSuffix,
  };
}

export function qosFor(suffix: TopicSuffix): 0 | 1 | 2 {
  return QOS_BY_SUFFIX[suffix];
}

export function isRetained(suffix: TopicSuffix): boolean {
  return RETAINED_SUFFIXES.has(suffix);
}
