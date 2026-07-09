import type { ExecutionStatus } from "./enums.js";

/**
 * 명령 수명주기 상태 머신 (SRS 4.3.4, PROJECT_RULES §4.3).
 *
 *   CREATED → PENDING → IN_PROGRESS → SUCCEEDED
 *                                 └→ FAILED
 *                                 └→ TIMED_OUT
 *
 * 모든 상태 전이는 Audit_Log 에 1행씩 기록되어야 한다(호출부 책임).
 * 이 모듈은 "허용된 전이"만 강제한다 — 상태 건너뛰기 금지.
 */
const ALLOWED_TRANSITIONS: Record<ExecutionStatus, readonly ExecutionStatus[]> = {
  CREATED: ["PENDING"],
  PENDING: ["IN_PROGRESS", "FAILED", "TIMED_OUT"],
  IN_PROGRESS: ["SUCCEEDED", "FAILED", "TIMED_OUT"],
  SUCCEEDED: [],
  FAILED: [],
  TIMED_OUT: [],
};

const TERMINAL: ReadonlySet<ExecutionStatus> = new Set([
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
]);

export function isTerminal(status: ExecutionStatus): boolean {
  return TERMINAL.has(status);
}

export function nextStatuses(from: ExecutionStatus): readonly ExecutionStatus[] {
  return ALLOWED_TRANSITIONS[from] ?? [];
}

export function canTransition(
  from: ExecutionStatus,
  to: ExecutionStatus,
): boolean {
  return nextStatuses(from).includes(to);
}

export class IllegalCommandTransitionError extends Error {
  constructor(
    public readonly from: ExecutionStatus,
    public readonly to: ExecutionStatus,
  ) {
    super(`허용되지 않은 명령 상태 전이: ${from} → ${to}`);
    this.name = "IllegalCommandTransitionError";
  }
}

/** 전이가 불법이면 throw. 호출부는 성공 시 Audit_Log 기록을 동일 트랜잭션으로 수행한다. */
export function assertTransition(
  from: ExecutionStatus,
  to: ExecutionStatus,
): void {
  if (!canTransition(from, to)) {
    throw new IllegalCommandTransitionError(from, to);
  }
}
