import { describe, expect, it } from "vitest";
import {
  assertAlarmTransition,
  canTransitionAlarm,
  IllegalAlarmTransitionError,
  nextAlarmStates,
} from "./alarmLifecycle.js";

describe("알람 상태 머신 (SRS 3.3)", () => {
  it("정상 경로: RAISED→ACK→RESOLVED", () => {
    expect(canTransitionAlarm("RAISED", "ACK")).toBe(true);
    expect(canTransitionAlarm("ACK", "RESOLVED")).toBe(true);
  });

  it("RAISED→SNOOZED, SNOOZED→ACK/RESOLVED/재스누즈 허용", () => {
    expect(canTransitionAlarm("RAISED", "SNOOZED")).toBe(true);
    expect(canTransitionAlarm("SNOOZED", "ACK")).toBe(true);
    expect(canTransitionAlarm("SNOOZED", "RESOLVED")).toBe(true);
    expect(canTransitionAlarm("SNOOZED", "SNOOZED")).toBe(true);
  });

  it("RAISED에서 바로 RESOLVED 허용(단순 알람은 확인 없이 바로 해제 가능)", () => {
    expect(canTransitionAlarm("RAISED", "RESOLVED")).toBe(true);
  });

  it("종결 상태(RESOLVED)에서는 어떤 전이도 불가", () => {
    expect(nextAlarmStates("RESOLVED")).toEqual([]);
    expect(canTransitionAlarm("RESOLVED", "ACK")).toBe(false);
    expect(canTransitionAlarm("RESOLVED", "RAISED")).toBe(false);
  });

  it("ACK→ACK 같은 무의미한 재전이는 불법", () => {
    expect(canTransitionAlarm("ACK", "ACK")).toBe(false);
  });

  it("assertAlarmTransition은 불법 전이에 throw", () => {
    expect(() => assertAlarmTransition("RAISED", "ACK")).not.toThrow();
    expect(() => assertAlarmTransition("RESOLVED", "ACK")).toThrow(IllegalAlarmTransitionError);
  });
});
