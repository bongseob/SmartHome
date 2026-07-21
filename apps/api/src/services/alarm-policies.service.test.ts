import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { AuthContext } from "@smarthome/auth";
import { AlarmPoliciesService, type CreateAlarmPolicyRequest } from "./alarm-policies.service.js";

// create()는 withTransaction(실제 DB 호출)보다 먼저 동기적으로 검증에서 throw하므로, DB를
// 모킹하지 않고도 이 케이스들을 안전하게 테스트할 수 있다(코드 리뷰 P2 #14).
const auth: AuthContext = { userId: "admin-1", username: "admin", roles: ["ADMIN"], topics: ["enterprise/#"] };

const BASE: CreateAlarmPolicyRequest = {
  name: "거실 과열",
  tier: "REACTIVE",
  targetType: "DEVICE",
  targetId: "device-1",
  metric: "temperature",
  operator: ">",
  thresholdValue: 40,
  durationSec: 60,
  severity: "CRITICAL",
};

describe("AlarmPoliciesService 입력 검증(코드 리뷰 P2 #14)", () => {
  const service = new AlarmPoliciesService();

  it("name이 비어 있으면 400", async () => {
    await expect(service.create({ ...BASE, name: " " }, auth)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("tier가 잘못된 값이면 400(잘못된 enum이 DB 500으로 새는 것을 사전 차단)", async () => {
    await expect(
      service.create({ ...BASE, tier: "INVALID" as CreateAlarmPolicyRequest["tier"] }, auth),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("targetType이 잘못된 값이면 400", async () => {
    await expect(
      service.create({ ...BASE, targetType: "INVALID" as CreateAlarmPolicyRequest["targetType"] }, auth),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("severity가 잘못된 값이면 400", async () => {
    await expect(
      service.create({ ...BASE, severity: "INVALID" as CreateAlarmPolicyRequest["severity"] }, auth),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("operator가 지원하지 않는 값이면 400", async () => {
    await expect(service.create({ ...BASE, operator: "~=" }, auth)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("durationSec이 음수면 400", async () => {
    await expect(service.create({ ...BASE, durationSec: -1 }, auth)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("thresholdValue가 NaN/Infinity면 400", async () => {
    await expect(service.create({ ...BASE, thresholdValue: Infinity }, auth)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
