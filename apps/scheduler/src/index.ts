import { randomUUID } from "node:crypto";
import { parseDeviceBase } from "@smarthome/contracts";
import { connect, publishServiceStatus, serviceWill, type MqttClient } from "@smarthome/mqtt";
import {
  closePool,
  getDeviceState,
  getLastRunForScheduler,
  insertScheduleRun,
  listGroupDeviceIds,
  listSchedulers,
  lockSchedulerById,
  query,
  reapStaleFiredRuns,
  updateScheduleRunCommandId,
  updateScheduleRunStatus,
  withTransaction,
  type SchedulerRecord,
} from "@smarthome/db";
import {
  createRedisCommandClient,
  publishDeviceCommand,
  type RedisCommandClient,
} from "@smarthome/command-flow";
import { computeDueState } from "./schedule-math.js";

/**
 * @smarthome/scheduler — ONE_TIME/DAILY/WEEKLY/MONTHLY/CRON → command 발행 (SRS 3.4).
 * command 발행/audit는 @smarthome/command-flow·command-service 단일 소스를 그대로 재사용한다.
 * EVENT 타입은 이벤트 소스가 SRS/PROJECT_RULES에 정의돼 있지 않아 이번 범위에서 제외한다(스킵).
 */

// node-redis(v4)는 소켓이 예기치 않게 끊기면(Redis 재기동 등) 내부적으로 'error'를
// 재전파하지 못하고 uncaughtException으로 새는 경우가 있다 — client.on("error", ...)를
// 붙여도 프로세스가 죽을 수 있다는 뜻이다. 재연결은 라이브러리가 기본 전략으로 알아서
// 재시도하므로, 여기서는 로그만 남기고 프로세스를 계속 살려둔다(크래시 방지).
process.on("uncaughtException", (err) => {
  console.error("[scheduler] 처리되지 않은 예외(계속 실행):", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[scheduler] 처리되지 않은 프로미스 거부(계속 실행):", reason);
});

const dbExecutor = { query };
const POLL_INTERVAL_MS = 15_000;
// claimIfDue가 커밋한 FIRED 행이 dispatchClaims 전/중에 프로세스가 죽어 command_id=null로
// 영원히 남는 것을 막는 회수 유예(코드 리뷰 P1 #8) — 정상적인 발행(같은 poll 내 병렬 처리,
// 보통 수 초)보다 넉넉히 길게 잡아 진행 중인 발행을 잘못 회수하지 않게 한다.
const STALE_FIRED_RUN_MS = 120_000;

interface Claim {
  deviceId: string;
  commandId: string;
  runId: string;
}

async function resolveTargetDeviceIds(schedule: SchedulerRecord): Promise<string[]> {
  if (schedule.targetType === "DEVICE") return [schedule.targetId];
  if (schedule.targetType === "GROUP") return listGroupDeviceIds(dbExecutor, schedule.targetId);
  console.warn(`[scheduler] schedule ${schedule.id} targetType=${schedule.targetType} 미지원 — 스킵`);
  return [];
}

/**
 * FOR UPDATE SKIP LOCKED로 scheduler row를 잠그고, due 판정 후 claim(schedule_run FIRED row 선기록)까지
 * 짧은 transaction 안에서 끝낸다 — 실제 MQTT 발행(네트워크 I/O)은 트랜잭션 밖에서 수행해 락을 오래
 * 잡지 않는다. 여러 scheduler 인스턴스가 동시에 폴링해도 이 SELECT ... FOR UPDATE가 중복 처리를 막는다.
 */
async function claimIfDue(schedule: SchedulerRecord): Promise<Claim[] | null> {
  return withTransaction(async (client) => {
    const locked = await lockSchedulerById(client, schedule.id);
    if (!locked || !locked.enabled) return null; // 다른 인스턴스가 처리 중이거나 비활성화됨

    const lastRun = await getLastRunForScheduler(client, locked.id);
    const decision = computeDueState(locked, new Date(), lastRun);
    if (decision === "NOT_DUE") return null;

    if (decision === "MISSED") {
      await insertScheduleRun(client, { schedulerId: locked.id, commandId: null, status: "SKIPPED" });
      console.warn(`[scheduler] schedule ${locked.id} '${locked.name}' 놓친 일정 → SKIPPED`);
      return null;
    }

    const deviceIds = await resolveTargetDeviceIds(locked);
    if (deviceIds.length === 0) {
      await insertScheduleRun(client, { schedulerId: locked.id, commandId: null, status: "FAILED" });
      console.error(`[scheduler] schedule ${locked.id} '${locked.name}' 대상 기기 없음 → FAILED`);
      return null;
    }

    const claims: Claim[] = [];
    for (const deviceId of deviceIds) {
      const commandId = `CMD-${Date.now()}-${randomUUID().slice(0, 8)}`;
      // command_id는 command(command_id) FK라 이 시점엔 아직 채울 수 없다(command row는 발행 후 생김) —
      // 클레임은 null로 먼저 남기고, 실제 발행 성공 후 updateScheduleRunCommandId로 채운다.
      const runRecord = await insertScheduleRun(client, {
        schedulerId: locked.id,
        commandId: null,
        status: "FIRED",
      });
      claims.push({ deviceId, commandId, runId: runRecord.id });
    }
    return claims;
  });
}

async function dispatchClaims(
  mqtt: MqttClient,
  redis: RedisCommandClient,
  schedule: SchedulerRecord,
  claims: Claim[],
): Promise<void> {
  const sessionId = `SCHED-${schedule.id}-${Date.now()}`;
  const payload = (schedule.payload ?? {}) as { command?: unknown; args?: Record<string, unknown> };
  const command = typeof payload.command === "string" ? payload.command : null;
  if (!command) {
    console.error(`[scheduler] schedule ${schedule.id} '${schedule.name}' payload.command 없음 — 발행 취소`);
    await Promise.all(claims.map((c) => updateScheduleRunStatus(dbExecutor, c.runId, "FAILED")));
    return;
  }

  await Promise.all(
    claims.map(async (claim) => {
      try {
        const device = await getDeviceState(dbExecutor, claim.deviceId);
        if (!device) throw new Error(`device not found: ${claim.deviceId}`);
        const identity = parseDeviceBase(device.mqttTopic);
        if (!identity) throw new Error(`device has invalid mqtt_topic: ${device.code}`);

        await publishDeviceCommand(mqtt, redis, {
          commandId: claim.commandId,
          sessionId,
          actorType: "SYSTEM",
          actorId: null,
          role: null,
          targetId: device.id,
          target: identity,
          command,
          ...(payload.args ? { args: payload.args } : {}),
        });
        await updateScheduleRunCommandId(dbExecutor, claim.runId, claim.commandId);
        console.log(
          `[scheduler] schedule ${schedule.id} '${schedule.name}' → device=${device.code} command=${command} (${claim.commandId})`,
        );
      } catch (err) {
        console.error(`[scheduler] schedule ${schedule.id} device=${claim.deviceId} 발행 실패:`, err);
        await updateScheduleRunStatus(dbExecutor, claim.runId, "FAILED");
      }
    }),
  );
}

async function pollOnce(mqtt: MqttClient, redis: RedisCommandClient): Promise<void> {
  try {
    const reaped = await reapStaleFiredRuns(dbExecutor, STALE_FIRED_RUN_MS);
    for (const run of reaped) {
      console.error(
        `[scheduler] schedule_run ${run.id}(scheduler=${run.schedulerId})가 발행 완료 없이 멈춰 있었음 → FAILED로 회수`,
      );
    }
  } catch (err) {
    console.error("[scheduler] stale schedule_run 회수 실패:", err);
  }

  let schedules: SchedulerRecord[];
  try {
    schedules = await listSchedulers(dbExecutor, { enabled: true });
  } catch (err) {
    console.error("[scheduler] 목록 조회 실패:", err);
    return;
  }

  for (const schedule of schedules) {
    if (schedule.scheduleType === "EVENT") continue; // 이벤트 소스 미구현 — 의도적 제외
    try {
      const claims = await claimIfDue(schedule);
      if (claims && claims.length > 0) {
        await dispatchClaims(mqtt, redis, schedule, claims);
      }
    } catch (err) {
      console.error(`[scheduler] schedule ${schedule.id} 처리 오류:`, err);
    }
  }
}

async function main(): Promise<void> {
  const url = process.env.MQTT_URL ?? "mqtt://localhost:1883";
  const redis = createRedisCommandClient();
  await redis.connect();
  console.log("[scheduler] redis 연결 — command correlation 활성화");

  const mqtt: MqttClient = connect(url, {
    clientId: `svc:scheduler-${process.pid}`,
    will: serviceWill("scheduler"),
  });
  // 최초 연결뿐 아니라 브로커 재기동 후 자동 재연결 때도 매번 다시 타야 한다 —
  // 한 번만 발행하면 재연결 후에도 프레즌스가 예전 OFFLINE(LWT)에 멈춰 있게 된다.
  mqtt.on("connect", () => publishServiceStatus(mqtt, "scheduler", "ONLINE"));
  await new Promise<void>((resolve) => mqtt.on("connect", () => resolve()));
  console.log(`[scheduler] ${url} 연결`);

  const pollTimer = setInterval(() => void pollOnce(mqtt, redis), POLL_INTERVAL_MS);
  void pollOnce(mqtt, redis); // 기동 즉시 1회 실행

  const shutdown = (): void => {
    clearInterval(pollTimer);
    publishServiceStatus(mqtt, "scheduler", "OFFLINE");
    mqtt.end(false, {}, () =>
      void redis.quit().then(() => closePool()).then(() => process.exit(0)),
    );
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main().catch((err: unknown) => {
  console.error("[scheduler] fatal:", err);
  process.exit(1);
});
