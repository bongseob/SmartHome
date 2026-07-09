import { describe, expect, it } from "vitest";
import {
  buildAreaAclTopic,
  buildTopic,
  buildDeviceBase,
  buildEnterpriseAclTopic,
  InvalidTopicSegmentError,
  isRetained,
  parseTopic,
  qosFor,
} from "./topics.js";

describe("buildTopic", () => {
  const base = {
    site: "site1",
    building: "bldg-a",
    floor: "2f",
    area: "living-room",
    device: "light-01",
  } as const;

  it("UNS 계층을 순서대로 조합한다", () => {
    expect(buildTopic({ ...base, suffix: "cmd" })).toBe(
      "enterprise/site1/bldg-a/2f/living-room/light-01/cmd",
    );
    expect(buildTopic({ ...base, suffix: "cmd/ack" })).toBe(
      "enterprise/site1/bldg-a/2f/living-room/light-01/cmd/ack",
    );
  });

  it("device 베이스는 suffix를 제외한다", () => {
    expect(buildDeviceBase(base)).toBe(
      "enterprise/site1/bldg-a/2f/living-room/light-01",
    );
  });

  it.each([
    ["대문자", "Light-01"],
    ["공백", "light 01"],
    ["슬래시", "light/01"],
    ["와일드카드+", "light+"],
    ["와일드카드#", "area#"],
    ["빈문자열", ""],
  ])("잘못된 세그먼트(%s)는 throw", (_label, device) => {
    expect(() => buildTopic({ ...base, device, suffix: "state" })).toThrow(
      InvalidTopicSegmentError,
    );
  });
});

describe("ACL topic builders", () => {
  it("admin용 enterprise wildcard topic을 생성한다", () => {
    expect(buildEnterpriseAclTopic()).toBe("enterprise/#");
  });

  it("area 권한용 wildcard topic을 검증된 UNS segment로 생성한다", () => {
    expect(
      buildAreaAclTopic({
        site: "site1",
        building: "bldg-a",
        floor: "2f",
        area: "living-room",
      }),
    ).toBe("enterprise/site1/bldg-a/2f/living-room/#");
  });
});

describe("parseTopic", () => {
  it("buildTopic 결과를 역파싱한다(round-trip)", () => {
    const parts = {
      site: "site1",
      building: "bldg-a",
      floor: "2f",
      area: "living-room",
      device: "light-01",
      suffix: "cmd/ack",
    } as const;
    expect(parseTopic(buildTopic(parts))).toEqual(parts);
  });

  it("telemetry/state suffix 파싱", () => {
    const p = parseTopic("enterprise/site1/bldg-a/2f/living-room/thermostat-01/telemetry");
    expect(p?.device).toBe("thermostat-01");
    expect(p?.suffix).toBe("telemetry");
  });

  it.each([
    ["루트 불일치", "acme/site1/b/f/a/d/state"],
    ["세그먼트 부족", "enterprise/site1/state"],
    ["알 수 없는 suffix", "enterprise/site1/b/f/a/d/unknown"],
  ])("잘못된 토픽(%s)은 null", (_label, topic) => {
    expect(parseTopic(topic)).toBeNull();
  });
});

describe("QoS / Retained 규칙 (SRS 4.1.1, PROJECT_RULES §3)", () => {
  it("QoS 매핑을 위반하지 않는다", () => {
    expect(qosFor("telemetry")).toBe(0);
    expect(qosFor("cmd")).toBe(1);
    expect(qosFor("cmd/ack")).toBe(1);
    expect(qosFor("state")).toBe(1);
    expect(qosFor("alarm")).toBe(2);
  });

  it("retained는 state만", () => {
    expect(isRetained("state")).toBe(true);
    expect(isRetained("telemetry")).toBe(false);
    expect(isRetained("cmd")).toBe(false);
    expect(isRetained("alarm")).toBe(false);
  });
});
