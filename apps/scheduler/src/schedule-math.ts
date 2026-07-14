// cron-parser는 CommonJS(`module.exports = CronParser`)라 named import는 tsc는 통과해도
// Node ESM 런타임에서는 실패한다 — default import 후 정적 메서드로 접근해야 한다.
import cronParser from "cron-parser";
import type { SchedulerRecord, ScheduleRunRecord } from "@smarthome/db";

/**
 * ONE_TIME/DAILY/WEEKLY/MONTHLY/CRON 발화 판정 (SRS 3.4). 순수 함수 — DB/시간 부작용 없음.
 * 타임존은 UTC 기준(로컬 타임존 지원은 후속, TODO 유지). EVENT는 이벤트 소스가 SRS/PROJECT_RULES에
 * 정의돼 있지 않아 이 모듈에서 다루지 않는다(호출부에서 스킵).
 */

/**
 * 기본 유예 — 폴링 주기(15초)의 정상적인 지연만 흡수하는 최소한의 여유다. 리눅스 cron과
 * 동일하게 기본값은 "다운타임 동안 놓친 발화를 뒤늦게 실행하지 않는다"(안전 정책, 2026-07-14
 * 사용자 결정) — 사람이 "이미 실행됐거나 아예 실행 안 됐겠지"라고 가정하는 시점에 장비가
 * 예기치 않게 상태를 바꾸는 위험을 막는다(고위험 장비일수록 치명적).
 */
export const DEFAULT_GRACE_MINUTES = 1;

/**
 * 다운타임 캐치업을 원하는 스케줄만 옵트인하는 확장 유예(scheduler.catch_up_enabled = true).
 * 사람이 매번 재실행 여부를 판단할 여유가 있는 저위험·비주기 알림성 스케줄 등에 한해 사용자가
 * 직접 켜는 경우에만 적용된다 — 기본값이 아니다.
 */
export const EXTENDED_GRACE_MINUTES = 10;

export type DueDecision = "DUE" | "MISSED" | "NOT_DUE";

function sameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function graceMs(catchUpEnabled: boolean): number {
  const minutes = catchUpEnabled ? EXTENDED_GRACE_MINUTES : DEFAULT_GRACE_MINUTES;
  return minutes * 60_000;
}

function decideFromIntendedMoment(
  now: Date,
  intended: Date,
  alreadyHandled: boolean,
  catchUpEnabled: boolean,
): DueDecision {
  if (alreadyHandled) return "NOT_DUE";
  if (now < intended) return "NOT_DUE";
  const lateMs = now.getTime() - intended.getTime();
  return lateMs <= graceMs(catchUpEnabled) ? "DUE" : "MISSED";
}

function withTimeOfDay(base: Date, timeSource: Date): Date {
  const result = new Date(base);
  result.setUTCHours(
    timeSource.getUTCHours(),
    timeSource.getUTCMinutes(),
    timeSource.getUTCSeconds(),
    0,
  );
  return result;
}

/** dayOfMonth가 이번 달 일수를 넘으면(예: 31일 지정 + 2월) 그 달의 마지막 날로 취급한다. */
function clampDayOfMonth(now: Date, dayOfMonth: number): number {
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return Math.min(dayOfMonth, daysInMonth);
}

export function computeDueState(
  schedule: SchedulerRecord,
  now: Date,
  lastRun: ScheduleRunRecord | null,
): DueDecision {
  switch (schedule.scheduleType) {
    case "ONE_TIME": {
      if (!schedule.runAt) return "NOT_DUE";
      // ONE_TIME은 평생 1회 — 이미 어떤 상태로든 기록이 있으면 다시 다루지 않는다.
      return decideFromIntendedMoment(now, schedule.runAt, lastRun !== null, schedule.catchUpEnabled);
    }

    case "DAILY": {
      if (!schedule.runAt) return "NOT_DUE";
      const intended = withTimeOfDay(now, schedule.runAt);
      const alreadyHandledToday = lastRun !== null && sameUtcDay(lastRun.firedAt, now);
      return decideFromIntendedMoment(now, intended, alreadyHandledToday, schedule.catchUpEnabled);
    }

    case "WEEKLY": {
      if (!schedule.runAt || !schedule.daysOfWeek || schedule.daysOfWeek.length === 0) return "NOT_DUE";
      if (!schedule.daysOfWeek.includes(now.getUTCDay())) return "NOT_DUE";
      const intended = withTimeOfDay(now, schedule.runAt);
      const alreadyHandledToday = lastRun !== null && sameUtcDay(lastRun.firedAt, now);
      return decideFromIntendedMoment(now, intended, alreadyHandledToday, schedule.catchUpEnabled);
    }

    case "MONTHLY": {
      if (!schedule.runAt || schedule.dayOfMonth === null) return "NOT_DUE";
      if (now.getUTCDate() !== clampDayOfMonth(now, schedule.dayOfMonth)) return "NOT_DUE";
      const intended = withTimeOfDay(now, schedule.runAt);
      const alreadyHandledToday = lastRun !== null && sameUtcDay(lastRun.firedAt, now);
      return decideFromIntendedMoment(now, intended, alreadyHandledToday, schedule.catchUpEnabled);
    }

    case "CRON": {
      if (!schedule.cronExpr) return "NOT_DUE";
      let prevFire: Date;
      try {
        const interval = cronParser.parseExpression(schedule.cronExpr, { currentDate: now, utc: true });
        prevFire = interval.prev().toDate();
      } catch {
        return "NOT_DUE"; // 잘못된 cron 식 — 정책 생성 시점에 검증하는 게 이상적이나 방어적으로 무시
      }
      const alreadyHandled = lastRun !== null && lastRun.firedAt >= prevFire;
      return decideFromIntendedMoment(now, prevFire, alreadyHandled, schedule.catchUpEnabled);
    }

    case "EVENT":
    default:
      return "NOT_DUE";
  }
}
