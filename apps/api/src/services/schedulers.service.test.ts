import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { AuthContext } from "@smarthome/auth";
import { SchedulersService, type CreateSchedulerRequest } from "./schedulers.service.js";

// validate()는 withTransaction(실제 DB 호출)보다 먼저 동기적으로 throw하므로, 여기서 검증하는
// 케이스들은 DB를 모킹하지 않고도 안전하게 테스트할 수 있다 — create()가 DB에 닿기 전에
// 항상 reject된다(코드 리뷰 P2 #14).
const auth: AuthContext = { userId: "admin-1", username: "admin", roles: ["ADMIN"], topics: ["enterprise/#"] };

// cronExpr는 CRON 테스트에서만 붙인다 — exactOptionalPropertyTypes 때문에 다른 scheduleType
// 테스트에서 `cronExpr: undefined`를 명시하면 타입 에러가 난다(속성 자체를 생략해야 함).
const BASE: Omit<CreateSchedulerRequest, "scheduleType"> = {
  name: "야간 소등",
  targetType: "GROUP",
  targetId: "group-1",
  payload: { command: "turn_off" },
};

describe("SchedulersService 입력 검증(코드 리뷰 P2 #14)", () => {
  const service = new SchedulersService();

  it("name이 비어 있으면 400", async () => {
    await expect(
      service.create({ ...BASE, name: "  ", scheduleType: "CRON", cronExpr: "0 23 * * *" }, auth),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("targetType이 잘못된 값이면 400", async () => {
    await expect(
      service.create(
        {
          ...BASE,
          targetType: "INVALID" as CreateSchedulerRequest["targetType"],
          scheduleType: "CRON",
          cronExpr: "0 23 * * *",
        },
        auth,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("scheduleType이 잘못된 값이면 400", async () => {
    await expect(
      service.create({ ...BASE, scheduleType: "INVALID" as CreateSchedulerRequest["scheduleType"] }, auth),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("payload.command가 없으면 400", async () => {
    await expect(
      service.create({ ...BASE, payload: {}, scheduleType: "CRON", cronExpr: "0 23 * * *" }, auth),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("CRON인데 cronExpr이 없으면 400", async () => {
    await expect(service.create({ ...BASE, scheduleType: "CRON" }, auth)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("CRON인데 cronExpr이 유효하지 않으면 400(schedule-math의 무한 미발화를 사전 차단)", async () => {
    await expect(
      service.create({ ...BASE, scheduleType: "CRON", cronExpr: "not a cron expression" }, auth),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("ONE_TIME인데 runAt이 없으면 400", async () => {
    await expect(service.create({ ...BASE, scheduleType: "ONE_TIME" }, auth)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("runAt이 파싱 불가능한 문자열이면 400", async () => {
    await expect(
      service.create({ ...BASE, scheduleType: "DAILY", runAt: "not-a-date" }, auth),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("WEEKLY인데 daysOfWeek이 없으면 400", async () => {
    await expect(
      service.create({ ...BASE, scheduleType: "WEEKLY", runAt: "2026-07-20T00:00:00Z" }, auth),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("WEEKLY인데 daysOfWeek에 범위 밖 값이 있으면 400", async () => {
    await expect(
      service.create(
        { ...BASE, scheduleType: "WEEKLY", runAt: "2026-07-20T00:00:00Z", daysOfWeek: [0, 7] },
        auth,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("MONTHLY인데 dayOfMonth가 범위 밖이면 400", async () => {
    await expect(
      service.create(
        { ...BASE, scheduleType: "MONTHLY", runAt: "2026-07-20T00:00:00Z", dayOfMonth: 32 },
        auth,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("update()도 동일한 검증을 거친다", async () => {
    await expect(
      service.update("sched-1", { ...BASE, name: "", scheduleType: "CRON", cronExpr: "0 23 * * *" }, auth),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
