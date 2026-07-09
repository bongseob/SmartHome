import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  IllegalCommandTransitionError,
  isTerminal,
} from "./lifecycle.js";

describe("명령 수명주기 상태 머신 (SRS 4.3.4)", () => {
  it("정상 경로: CREATED→PENDING→IN_PROGRESS→SUCCEEDED", () => {
    expect(canTransition("CREATED", "PENDING")).toBe(true);
    expect(canTransition("PENDING", "IN_PROGRESS")).toBe(true);
    expect(canTransition("IN_PROGRESS", "SUCCEEDED")).toBe(true);
  });

  it("실패/타임아웃 분기 허용", () => {
    expect(canTransition("PENDING", "TIMED_OUT")).toBe(true);
    expect(canTransition("IN_PROGRESS", "FAILED")).toBe(true);
    expect(canTransition("IN_PROGRESS", "TIMED_OUT")).toBe(true);
  });

  it("상태 건너뛰기 금지", () => {
    expect(canTransition("CREATED", "IN_PROGRESS")).toBe(false);
    expect(canTransition("CREATED", "SUCCEEDED")).toBe(false);
    expect(canTransition("PENDING", "SUCCEEDED")).toBe(false);
  });

  it("종료 상태에서는 전이 불가", () => {
    expect(isTerminal("SUCCEEDED")).toBe(true);
    expect(isTerminal("FAILED")).toBe(true);
    expect(isTerminal("TIMED_OUT")).toBe(true);
    expect(isTerminal("PENDING")).toBe(false);
    expect(canTransition("SUCCEEDED", "FAILED")).toBe(false);
  });

  it("assertTransition은 불법 전이에 throw", () => {
    expect(() => assertTransition("CREATED", "PENDING")).not.toThrow();
    expect(() => assertTransition("CREATED", "SUCCEEDED")).toThrow(
      IllegalCommandTransitionError,
    );
  });
});
