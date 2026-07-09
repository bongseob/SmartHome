import {
  AckPayload,
  IllegalCommandTransitionError,
  parseTopic,
  StatePayload,
  TelemetryPayload,
  type ExecutionStatus,
  type TargetType,
} from "@smarthome/contracts";
import { connect, type MqttClient } from "@smarthome/mqtt";
import {
  closePool,
  completeCommandFromAck,
  getDeviceIdByCode,
  insertTelemetryBatch,
  raiseOfflineAlarm,
  setDeviceStatus,
  transitionCommandWithAudit,
  type TelemetryRow,
} from "@smarthome/db";
import {
  clearCorrelation,
  createRedisCommandClient,
  dueCommandIds,
  getCorrelation,
  updateCorrelationStatus,
  type RedisCommandClient,
} from "@smarthome/command-flow";
import {
  createRealtimePublisher,
  publishRealtimeEvent,
  type RealtimePublisher,
} from "@smarthome/realtime";

/**
 * @smarthome/gateway — MQTT 인제스트 (docs/architecture.md §8).
 * 공유구독($share)으로 telemetry/state 수집:
 *  - telemetry(QoS0) → 버퍼 → 배치 insert(TimescaleDB)
 *  - state(QoS1)     → device.current_status 갱신, OFFLINE 이면 alarm_log
 *  - cmd/ack(QoS1)   → command 상태 전이 + audit_log
 * 명령 발행/상관은 @smarthome/command-flow, 대시보드 실시간 이벤트는
 * @smarthome/realtime(Redis pub/sub) 단일 소스를 재사용한다.
 */

// code → device.id 캐시(음성 캐시 포함: 미등록은 null)
const idCache = new Map<string, string | null>();
async function resolveDeviceId(code: string): Promise<string | null> {
  const cached = idCache.get(code);
  if (cached !== undefined) return cached;
  const id = await getDeviceIdByCode(code);
  idCache.set(code, id);
  if (id === null) console.warn(`[gateway] 미등록 device '${code}' — 데이터 무시`);
  return id;
}

// 상태 변화 감지(retained 재수신·중복 억제)
const lastStatus = new Map<string, string>();

// 텔레메트리 배치 버퍼
let buffer: TelemetryRow[] = [];
async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const rows = buffer;
  buffer = [];
  try {
    await insertTelemetryBatch(rows);
    console.log(`[gateway] telemetry flush ${rows.length}행`);
  } catch (err) {
    console.error("[gateway] telemetry insert 오류:", err);
  }
}

function ackStatusToExecutionStatus(status: "IN_PROGRESS" | "SUCCEEDED" | "FAILED"): ExecutionStatus {
  return status;
}

async function handleAckMessage(
  redis: RedisCommandClient,
  events: RealtimePublisher,
  deviceFromTopic: string,
  json: unknown,
): Promise<void> {
  const parsed = AckPayload.safeParse(json);
  if (!parsed.success) return;
  const ack = parsed.data;
  if (ack.deviceId !== deviceFromTopic) {
    console.warn(
      `[gateway] ack device mismatch topic=${deviceFromTopic}, payload=${ack.deviceId}, command=${ack.commandId}`,
    );
    return;
  }

  try {
    const correlation = await getCorrelation(redis, ack.commandId);
    if (!correlation) {
      console.warn(`[gateway] ack correlation missing command=${ack.commandId}`);
    } else if (correlation.deviceCode !== ack.deviceId) {
      console.warn(
        `[gateway] ack correlation mismatch command=${ack.commandId}, expected=${correlation.deviceCode}, payload=${ack.deviceId}`,
      );
      return;
    }

    if (ack.status === "IN_PROGRESS") {
      if (correlation) {
        await updateCorrelationStatus(
          redis,
          { ...correlation, status: "IN_PROGRESS" },
          Math.max(correlation.deadlineEpochMs - Date.now() + 5000, 1000),
        );
      }
      console.log(`[gateway] ack ${ack.commandId} → IN_PROGRESS`);
      return;
    }

    const status = ackStatusToExecutionStatus(ack.status);
    // PENDING 상태에서 종결 ack가 도착하는 레이스를 흡수(IN_PROGRESS 경유, 중복 ack 멱등)
    const result = await completeCommandFromAck({
      commandId: ack.commandId,
      toStatus: status,
      reason: `device ack ${ack.status}`,
      mqttReasonCode: ack.reasonCode ?? null,
    });
    await clearCorrelation(redis, ack.commandId);
    if (result.applied) {
      await publishRealtimeEvent(events, {
        type: "command.status",
        commandId: ack.commandId,
        status: result.command.status,
        targetType: result.command.targetType,
        targetId: result.command.targetId,
        ts: Date.now(),
      });
    }
    console.log(
      `[gateway] ack ${ack.commandId} → ${ack.status}${result.applied ? "" : " (already terminal, no-op)"}`,
    );
  } catch (err) {
    console.error(`[gateway] ack 처리 오류 command=${ack.commandId}:`, err);
  }
}

async function onMessage(
  redis: RedisCommandClient,
  events: RealtimePublisher,
  topic: string,
  payload: Buffer,
): Promise<void> {
  const parts = parseTopic(topic);
  if (!parts) return;

  let json: unknown;
  try {
    json = JSON.parse(payload.toString());
  } catch {
    return;
  }

  if (parts.suffix === "telemetry") {
    const parsed = TelemetryPayload.safeParse(json);
    if (!parsed.success) return;
    const id = await resolveDeviceId(parts.device);
    if (!id) return;
    const time = new Date(parsed.data.ts);
    for (const [metric, value] of Object.entries(parsed.data.metrics)) {
      buffer.push({
        time,
        deviceId: id,
        metric,
        valueNum: typeof value === "number" ? value : null,
        valueText: typeof value === "string" ? value : null,
      });
    }
    return;
  }

  if (parts.suffix === "state") {
    const parsed = StatePayload.safeParse(json);
    if (!parsed.success) return;
    const status = parsed.data.status;
    if (lastStatus.get(parts.device) === status) return; // 변화 없음
    lastStatus.set(parts.device, status);
    await setDeviceStatus(parts.device, status);
    console.log(`[gateway] state ${parts.device} → ${status}`);
    const id = await resolveDeviceId(parts.device);
    if (id) {
      await publishRealtimeEvent(events, {
        type: "device.state",
        deviceId: id,
        deviceCode: parts.device,
        status,
        ts: Date.now(),
      });
      if (status === "OFFLINE") {
        const message = "device offline (state/LWT)";
        await raiseOfflineAlarm(id, message);
        await publishRealtimeEvent(events, {
          type: "alarm.raised",
          deviceId: id,
          tier: "REACTIVE",
          severity: "WARNING",
          message,
          ts: Date.now(),
        });
      }
    }
    return;
  }

  if (parts.suffix === "cmd/ack") {
    await handleAckMessage(redis, events, parts.device, json);
  }
}

async function sweepCommandTimeouts(
  redis: RedisCommandClient,
  events: RealtimePublisher,
): Promise<void> {
  const due = await dueCommandIds(redis);
  for (const commandId of due) {
    const correlation = await getCorrelation(redis, commandId);
    // correlation 키가 TTL로 먼저 사라졌어도(예: gateway 장기 중단 후 재시작)
    // zset에 남은 명령은 반드시 DB에서 종결시킨다 — 없으면 영원히 IN_PROGRESS로 남는다.
    if (correlation && correlation.deadlineEpochMs > Date.now()) continue;

    try {
      const record = await lockFreeTimeoutTransition(commandId);
      if (record) {
        console.warn(`[gateway] command ${commandId} timed out`);
        await publishRealtimeEvent(events, {
          type: "command.status",
          commandId,
          status: "TIMED_OUT",
          targetType: record.targetType,
          targetId: record.targetId,
          ts: Date.now(),
        });
      }
    } catch (err) {
      console.error(`[gateway] timeout 처리 오류 command=${commandId}:`, err);
    } finally {
      await clearCorrelation(redis, commandId);
    }
  }
}

/** 이미 종결(ack 선처리)된 명령이면 조용히 건너뛰고(null), 아니면 TIMED_OUT 전이+audit 후 레코드 반환 */
async function lockFreeTimeoutTransition(
  commandId: string,
): Promise<{ targetType: TargetType; targetId: string } | null> {
  try {
    const updated = await transitionCommandWithAudit({
      commandId,
      toStatus: "TIMED_OUT",
      reason: "mqtt command ack timeout",
    });
    return { targetType: updated.targetType, targetId: updated.targetId };
  } catch (err) {
    if (err instanceof IllegalCommandTransitionError) return null; // 이미 종결 — 정상
    throw err;
  }
}

async function main(): Promise<void> {
  const url = process.env.MQTT_URL ?? "mqtt://localhost:1883";
  const redis = createRedisCommandClient();
  await redis.connect();
  console.log("[gateway] redis 연결 — command correlation 활성화");

  const events = createRealtimePublisher();
  await events.connect();
  console.log("[gateway] redis 연결 — 실시간 이벤트 발행 활성화");

  const client: MqttClient = connect(url, { clientId: "svc:gateway-1" });

  client.on("connect", () => {
    const subs = [
      "$share/gw/enterprise/+/+/+/+/+/telemetry",
      "$share/gw/enterprise/+/+/+/+/+/state",
      "$share/gw/enterprise/+/+/+/+/+/cmd/ack",
    ];
    for (const s of subs) {
      client.subscribe(s, { qos: s.endsWith("telemetry") ? 0 : 1 });
    }
    console.log(`[gateway] ${url} 연결 — 공유구독 시작`);
  });
  client.on("message", (topic: string, payload: Buffer) => {
    void onMessage(redis, events, topic, payload);
  });
  client.on("error", (err: Error) => console.error(`[gateway] mqtt error: ${err.message}`));

  const flushTimer = setInterval(() => void flush(), 500);
  const timeoutTimer = setInterval(() => void sweepCommandTimeouts(redis, events), 1000);

  const shutdown = (): void => {
    clearInterval(flushTimer);
    clearInterval(timeoutTimer);
    void flush().then(() =>
      client.end(false, {}, () =>
        void redis
          .quit()
          .then(() => events.quit())
          .then(() => closePool())
          .then(() => process.exit(0)),
      ),
    );
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main().catch((err: unknown) => {
  console.error("[gateway] fatal:", err);
  process.exit(1);
});
