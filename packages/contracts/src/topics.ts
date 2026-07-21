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

/**
 * 층(Floor) 토픽 프리픽스(area·디바이스·suffix 없는 4세그먼트) — "이 층에 속한 모든 지역"을
 * 가리킬 때 쓴다. area 단위보다 한 단계 위 집계용(예: 층별 대시보드 topicPrefix).
 * DB에서 slug를 조합해 SQL/TS에서 직접 문자열을 만들지 말고 이 함수로만 만든다
 * (CLAUDE.md — UNS 토픽 문자열 하드코딩 금지).
 */
export function buildFloorTopicPrefix(parts: { site: string; building: string; floor: string }): string {
  assertSegment("site", parts.site);
  assertSegment("building", parts.building);
  assertSegment("floor", parts.floor);
  return [UNS_ROOT, parts.site, parts.building, parts.floor].join("/");
}

/**
 * 지역(Area) 토픽 프리픽스(디바이스·suffix 없는 5세그먼트) — "이 지역에 속한 모든 기기"를
 * 가리킬 때 쓴다(알람/카메라/기기 목록에서 지역별로 묶어 보여줄 때, area_topic_prefix로 응답).
 * DB에서 site/building/floor/area slug를 조합해 SQL로 직접 문자열을 만들지 말고 이 함수로만
 * 만든다(CLAUDE.md — UNS 토픽 문자열 하드코딩 금지, 반드시 buildTopic() 계열 사용).
 */
export function buildAreaTopicPrefix(parts: {
  site: string;
  building: string;
  floor: string;
  area: string;
}): string {
  assertSegment("site", parts.site);
  assertSegment("building", parts.building);
  assertSegment("floor", parts.floor);
  assertSegment("area", parts.area);
  return [UNS_ROOT, parts.site, parts.building, parts.floor, parts.area].join("/");
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

/**
 * 기기 베이스 토픽(suffix 없는 6세그먼트, device.mqtt_topic 저장값)을 분해한다.
 * DB에 저장된 canonical 토픽에서 identity를 도출할 때 사용 — 클라이언트가 보낸
 * 토픽 세그먼트를 신뢰하지 않기 위한 서버측 역변환.
 */
export function parseDeviceBase(base: string): Omit<TopicParts, "suffix"> | null {
  const segs = base.split("/");
  if (segs.length !== 6) return null;
  const [root, site, building, floor, area, device] = segs;
  if (root !== UNS_ROOT) return null;
  if (!site || !building || !floor || !area || !device) return null;
  for (const seg of [site, building, floor, area, device]) {
    if (!SEGMENT_PATTERN.test(seg)) return null;
  }
  return { site, building, floor, area, device };
}

export function qosFor(suffix: TopicSuffix): 0 | 1 | 2 {
  return QOS_BY_SUFFIX[suffix];
}

export function isRetained(suffix: TopicSuffix): boolean {
  return RETAINED_SUFFIXES.has(suffix);
}

/**
 * 서비스 프레즌스(생존 여부) 토픽 — 기기 UNS 네임스페이스(enterprise/...)와는 별개의
 * 플랫폼 인프라 채널이다. HTTP 포트를 새로 열지 않고, 각 백엔드 프로세스가 이미 맺고 있는
 * MQTT 연결의 LWT(retained)로 온/오프라인을 알린다 — 기기 LWT(SRS 4.1.2)와 동일한 패턴.
 */
export const SERVICE_NAMES = ["api", "gateway", "scheduler", "device-simulator"] as const;
export type ServiceName = (typeof SERVICE_NAMES)[number];

export function buildServiceStatusTopic(service: ServiceName): string {
  return `platform/service/${service}/status`;
}

/** 구독측(API)이 모든 서비스 프레즌스를 한 번에 받기 위한 와일드카드 토픽. */
export function buildServiceStatusWildcard(): string {
  return "platform/service/+/status";
}
