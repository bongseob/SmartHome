import type { AlarmState } from "./enums.js";

/**
 * 알람 상태 머신 (SRS 3.3, PROJECT_RULES §8 — command lifecycle.ts와 동일한 패턴).
 *
 *   RAISED → ACK ──────┐
 *        │             ├→ RESOLVED
 *        └→ SNOOZED ⇄ ─┘
 *
 * RESOLVED는 종결 상태 — 이후 전이는 없다(재오픈은 새 알람으로 raise).
 * NOTE 액션은 상태를 바꾸지 않으므로 이 상태 머신 밖에서 처리한다(호출부 책임).
 */
const ALLOWED_ALARM_TRANSITIONS: Record<AlarmState, readonly AlarmState[]> = {
  RAISED: ["ACK", "SNOOZED", "RESOLVED"],
  ACK: ["SNOOZED", "RESOLVED"],
  SNOOZED: ["ACK", "RESOLVED", "SNOOZED"],
  RESOLVED: [],
};

export function nextAlarmStates(from: AlarmState): readonly AlarmState[] {
  return ALLOWED_ALARM_TRANSITIONS[from] ?? [];
}

export function canTransitionAlarm(from: AlarmState, to: AlarmState): boolean {
  return nextAlarmStates(from).includes(to);
}

export class IllegalAlarmTransitionError extends Error {
  constructor(
    public readonly from: AlarmState,
    public readonly to: AlarmState,
  ) {
    super(`허용되지 않은 알람 상태 전이: ${from} → ${to}`);
    this.name = "IllegalAlarmTransitionError";
  }
}

/** 전이가 불법이면 throw. 호출부는 성공 시 Audit_Log 기록을 동일 트랜잭션으로 수행한다. */
export function assertAlarmTransition(from: AlarmState, to: AlarmState): void {
  if (!canTransitionAlarm(from, to)) {
    throw new IllegalAlarmTransitionError(from, to);
  }
}
