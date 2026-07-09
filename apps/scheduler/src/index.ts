import { ScheduleType } from "@smarthome/contracts";

/**
 * @smarthome/scheduler — cron/one-time/event → 명령 발행 (docs/architecture.md, SRS 3.4).
 * TODO: 분산 단일 발화 락, 놓친 일정 처리, 타임존, schedule_run 기록.
 */
export function main(): void {
  console.log(
    `[scheduler] 스캐폴딩 OK — 지원 방식=${ScheduleType.options.join(", ")}. 구현 예정.`,
  );
}

main();
