import { describe, expect, it } from "vitest";
import type { SchedulerRecord, ScheduleRunRecord } from "@smarthome/db";
import { computeDueState } from "./schedule-math.js";

function baseSchedule(overrides: Partial<SchedulerRecord> = {}): SchedulerRecord {
  return {
    id: "s1",
    name: "test",
    targetType: "DEVICE",
    targetId: "device-1",
    scheduleType: "ONE_TIME",
    runAt: null,
    cronExpr: null,
    daysOfWeek: null,
    dayOfMonth: null,
    eventTrigger: null,
    payload: {},
    enabled: true,
    catchUpEnabled: false,
    ...overrides,
  };
}

function run(firedAt: Date, status: ScheduleRunRecord["status"] = "FIRED"): ScheduleRunRecord {
  return { id: "r1", schedulerId: "s1", firedAt, commandId: "CMD-1", status };
}

describe("computeDueState — ONE_TIME", () => {
  it("run_at가 아직 안 됐으면 NOT_DUE", () => {
    const now = new Date("2026-07-10T10:00:00Z");
    const schedule = baseSchedule({ scheduleType: "ONE_TIME", runAt: new Date("2026-07-10T11:00:00Z") });
    expect(computeDueState(schedule, now, null)).toBe("NOT_DUE");
  });

  it("run_at 도달 + 기본 유예(1분) 이내면 DUE", () => {
    const schedule = baseSchedule({ scheduleType: "ONE_TIME", runAt: new Date("2026-07-10T10:00:00Z") });
    const now = new Date("2026-07-10T10:00:30Z");
    expect(computeDueState(schedule, now, null)).toBe("DUE");
  });

  it("기본(캐치업 꺼짐)은 1분만 넘겨도 리눅스 cron처럼 MISSED — 뒤늦게 실행하지 않는다", () => {
    const schedule = baseSchedule({ scheduleType: "ONE_TIME", runAt: new Date("2026-07-10T10:00:00Z") });
    const now = new Date("2026-07-10T10:02:00Z");
    expect(computeDueState(schedule, now, null)).toBe("MISSED");
  });

  it("기본 유예를 크게 넘겨 늦으면 MISSED", () => {
    const schedule = baseSchedule({ scheduleType: "ONE_TIME", runAt: new Date("2026-07-10T10:00:00Z") });
    const now = new Date("2026-07-10T10:30:00Z");
    expect(computeDueState(schedule, now, null)).toBe("MISSED");
  });

  it("이미 어떤 기록이든 있으면(FIRED/SKIPPED) 평생 다시 다루지 않는다", () => {
    const schedule = baseSchedule({ scheduleType: "ONE_TIME", runAt: new Date("2026-07-10T10:00:00Z") });
    const now = new Date("2026-07-10T10:05:00Z");
    expect(computeDueState(schedule, now, run(new Date("2026-07-10T10:01:00Z")))).toBe("NOT_DUE");
  });
});

describe("computeDueState — 캐치업 옵트인(catchUpEnabled)", () => {
  it("꺼짐(기본)이면 8분 지연도 MISSED", () => {
    const schedule = baseSchedule({
      scheduleType: "ONE_TIME",
      runAt: new Date("2026-07-10T10:00:00Z"),
      catchUpEnabled: false,
    });
    const now = new Date("2026-07-10T10:08:00Z");
    expect(computeDueState(schedule, now, null)).toBe("MISSED");
  });

  it("켜져 있으면 8분 지연은 확장 유예(10분) 이내라 DUE", () => {
    const schedule = baseSchedule({
      scheduleType: "ONE_TIME",
      runAt: new Date("2026-07-10T10:00:00Z"),
      catchUpEnabled: true,
    });
    const now = new Date("2026-07-10T10:08:00Z");
    expect(computeDueState(schedule, now, null)).toBe("DUE");
  });

  it("켜져 있어도 확장 유예(10분)를 넘기면 MISSED", () => {
    const schedule = baseSchedule({
      scheduleType: "ONE_TIME",
      runAt: new Date("2026-07-10T10:00:00Z"),
      catchUpEnabled: true,
    });
    const now = new Date("2026-07-10T10:15:00Z");
    expect(computeDueState(schedule, now, null)).toBe("MISSED");
  });
});

describe("computeDueState — DAILY", () => {
  it("당일 시각 도달 전이면 NOT_DUE", () => {
    const schedule = baseSchedule({ scheduleType: "DAILY", runAt: new Date("2000-01-01T09:00:00Z") });
    const now = new Date("2026-07-10T08:59:00Z");
    expect(computeDueState(schedule, now, null)).toBe("NOT_DUE");
  });

  it("당일 시각 도달 + 오늘 기록 없으면 DUE", () => {
    const schedule = baseSchedule({ scheduleType: "DAILY", runAt: new Date("2000-01-01T09:00:00Z") });
    const now = new Date("2026-07-10T09:00:30Z");
    expect(computeDueState(schedule, now, null)).toBe("DUE");
  });

  it("오늘 이미 실행됐으면 다시 DUE 아님", () => {
    const schedule = baseSchedule({ scheduleType: "DAILY", runAt: new Date("2000-01-01T09:00:00Z") });
    const now = new Date("2026-07-10T09:02:00Z");
    expect(computeDueState(schedule, now, run(new Date("2026-07-10T09:00:30Z")))).toBe("NOT_DUE");
  });

  it("어제 실행 기록은 오늘 재발화를 막지 않는다", () => {
    const schedule = baseSchedule({ scheduleType: "DAILY", runAt: new Date("2000-01-01T09:00:00Z") });
    const now = new Date("2026-07-10T09:00:30Z");
    expect(computeDueState(schedule, now, run(new Date("2026-07-09T09:00:30Z")))).toBe("DUE");
  });
});

describe("computeDueState — WEEKLY", () => {
  it("요일이 안 맞으면 NOT_DUE", () => {
    // 2026-07-10은 금요일(5) — 월요일(1)만 지정
    const schedule = baseSchedule({
      scheduleType: "WEEKLY",
      runAt: new Date("2000-01-01T09:00:00Z"),
      daysOfWeek: [1],
    });
    const now = new Date("2026-07-10T09:02:00Z");
    expect(computeDueState(schedule, now, null)).toBe("NOT_DUE");
  });

  it("요일이 맞으면 DAILY와 동일하게 판정", () => {
    const schedule = baseSchedule({
      scheduleType: "WEEKLY",
      runAt: new Date("2000-01-01T09:00:00Z"),
      daysOfWeek: [5],
    });
    const now = new Date("2026-07-10T09:00:30Z");
    expect(computeDueState(schedule, now, null)).toBe("DUE");
  });
});

describe("computeDueState — MONTHLY", () => {
  it("일자가 안 맞으면 NOT_DUE", () => {
    const schedule = baseSchedule({
      scheduleType: "MONTHLY",
      runAt: new Date("2000-01-01T09:00:00Z"),
      dayOfMonth: 1,
    });
    const now = new Date("2026-07-10T09:02:00Z");
    expect(computeDueState(schedule, now, null)).toBe("NOT_DUE");
  });

  it("31일 지정 + 2월처럼 짧은 달이면 말일로 클램프된다", () => {
    const schedule = baseSchedule({
      scheduleType: "MONTHLY",
      runAt: new Date("2000-01-01T09:00:00Z"),
      dayOfMonth: 31,
    });
    // 2026년 2월은 28일까지
    const now = new Date("2026-02-28T09:00:30Z");
    expect(computeDueState(schedule, now, null)).toBe("DUE");
  });
});

describe("computeDueState — CRON", () => {
  it("매시 정각 cron, 직전 발화 시점 이후면 DUE", () => {
    const schedule = baseSchedule({ scheduleType: "CRON", cronExpr: "0 * * * *" });
    const now = new Date("2026-07-10T10:00:30Z");
    expect(computeDueState(schedule, now, null)).toBe("DUE");
  });

  it("같은 slot을 이미 처리했으면 NOT_DUE", () => {
    const schedule = baseSchedule({ scheduleType: "CRON", cronExpr: "0 * * * *" });
    const now = new Date("2026-07-10T10:02:00Z");
    expect(computeDueState(schedule, now, run(new Date("2026-07-10T10:00:05Z")))).toBe("NOT_DUE");
  });

  it("잘못된 cron 식은 NOT_DUE(방어적으로 무시)", () => {
    const schedule = baseSchedule({ scheduleType: "CRON", cronExpr: "not-a-cron" });
    const now = new Date("2026-07-10T10:02:00Z");
    expect(computeDueState(schedule, now, null)).toBe("NOT_DUE");
  });
});

describe("computeDueState — EVENT", () => {
  it("이벤트 소스 미구현 — 항상 NOT_DUE", () => {
    const schedule = baseSchedule({ scheduleType: "EVENT" });
    expect(computeDueState(schedule, new Date(), null)).toBe("NOT_DUE");
  });
});
