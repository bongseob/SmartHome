import {
  AckPayload,
  CommandPayload,
  IllegalCommandTransitionError,
  parseTopic,
  StatePayload,
  TelemetryPayload,
  type ActorType,
  type ExecutionStatus,
  type Role,
} from "@smarthome/contracts";
import { connect, publish, type DeviceIdentity, type MqttClient } from "@smarthome/mqtt";
import {
  closePool,
  completeCommandFromAck,
  createCommandWithAuditResult,
  getDeviceIdByCode,
  insertTelemetryBatch,
  raiseOfflineAlarm,
  setDeviceStatus,
  transitionCommandWithAudit,
  type CommandRecord,
  type TelemetryRow,
} from "@smarthome/db";
import {
  clearCorrelation,
  createRedisCommandClient,
  defaultCommandSlaMs,
  dueCommandIds,
  getCorrelation,
  storeNewCorrelation,
  updateCorrelationStatus,
  type CommandCorrelationState,
  type RedisCommandClient,
} from "./command-correlation.js";

/**
 * @smarthome/gateway — MQTT 인제스트 (docs/architecture.md §8).
 * 공유구독($share)으로 telemetry/state 수집:
 *  - telemetry(QoS0) → 버퍼 → 배치 insert(TimescaleDB)
 *  - state(QoS1)     → device.current_status 갱신, OFFLINE 이면 alarm_log
 *  - cmd/ack(QoS1)   → command 상태 전이 + audit_log
 * TODO(후속): Redis ack 상관·타임아웃 스위퍼·alarm 인테이크.
 */

export interface PublishDeviceCommandInput {
  commandId: string;
  sessionId: string;
  actorType: ActorType;
  actorId: string | null;
  role: Role;
  targetId: string;
  target: DeviceIdentity;
  command: string;
  args?: Record<string, unknown>;
}

export interface PublishDeviceCommandResult {
  command: CommandRecord;
  published: boolean;
}

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

/**
 * command 생성(CREATED audit) → PENDING audit → MQTT /cmd 발행 → IN_PROGRESS audit.
 * 중복 commandId는 멱등성 재요청으로 보고 재발행하지 않는다.
 */
export async function publishDeviceCommand(
  client: MqttClient,
  redis: RedisCommandClient,
  input: PublishDeviceCommandInput,
): Promise<PublishDeviceCommandResult> {
  const timestamp = Date.now();
  const slaMs = defaultCommandSlaMs();
  const deadlineEpochMs = timestamp + slaMs;
  const payload: CommandPayload = {
    sessionId: input.sessionId,
    commandId: input.commandId,
    command: input.command,
    target: input.target.device,
    timestamp,
    ...(input.args ? { args: input.args } : {}),
  };

  const created = await createCommandWithAuditResult({
    commandId: input.commandId,
    sessionId: input.sessionId,
    actorType: input.actorType,
    actorId: input.actorId,
    role: input.role,
    targetType: "DEVICE",
    targetId: input.targetId,
    command: input.command,
    payload,
  });

  if (!created.inserted) {
    console.warn(`[gateway] duplicate commandId '${input.commandId}' — MQTT 재발행 생략`);
    return { command: created.command, published: false };
  }

  await transitionCommandWithAudit({
    commandId: input.commandId,
    toStatus: "PENDING",
    reason: "command accepted for mqtt publish",
  });

  const pendingCorrelation: CommandCorrelationState = {
    commandId: input.commandId,
    deviceCode: input.target.device,
    sessionId: input.sessionId,
    status: "PENDING",
    deadlineEpochMs,
  };
  const correlationStored = await storeNewCorrelation(redis, pendingCorrelation, slaMs + 5000);
  if (!correlationStored) {
    throw new Error(`command correlation already exists: ${input.commandId}`);
  }

  publish(client, input.target, "cmd", payload, {
    actorId: input.actorId ?? input.actorType,
    sessionId: input.sessionId,
    commandId: input.commandId,
    role: input.role,
    requestTimeMs: timestamp,
  });

  const inProgress = await transitionCommandWithAudit({
    commandId: input.commandId,
    toStatus: "IN_PROGRESS",
    reason: "mqtt command published",
  });
  await updateCorrelationStatus(
    redis,
    { ...pendingCorrelation, status: "IN_PROGRESS" },
    Math.max(deadlineEpochMs - Date.now() + 5000, 1000),
  );

  console.log(`[gateway] command ${input.commandId} published → ${input.target.device}`);
  return { command: inProgress, published: true };
}

async function handleAckMessage(
  redis: RedisCommandClient,
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
    console.log(
      `[gateway] ack ${ack.commandId} → ${ack.status}${result.applied ? "" : " (already terminal, no-op)"}`,
    );
  } catch (err) {
    console.error(`[gateway] ack 처리 오류 command=${ack.commandId}:`, err);
  }
}

async function onMessage(redis: RedisCommandClient, topic: string, payload: Buffer): Promise<void> {
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
    if (status === "OFFLINE") {
      const id = await resolveDeviceId(parts.device);
      if (id) await raiseOfflineAlarm(id, "device offline (state/LWT)");
    }
    return;
  }

  if (parts.suffix === "cmd/ack") {
    await handleAckMessage(redis, parts.device, json);
  }
}

async function sweepCommandTimeouts(redis: RedisCommandClient): Promise<void> {
  const due = await dueCommandIds(redis);
  for (const commandId of due) {
    const correlation = await getCorrelation(redis, commandId);
    // correlation 키가 TTL로 먼저 사라졌어도(예: gateway 장기 중단 후 재시작)
    // zset에 남은 명령은 반드시 DB에서 종결시킨다 — 없으면 영원히 IN_PROGRESS로 남는다.
    if (correlation && correlation.deadlineEpochMs > Date.now()) continue;

    try {
      const timedOut = await lockFreeTimeoutTransition(commandId);
      if (timedOut) console.warn(`[gateway] command ${commandId} timed out`);
    } catch (err) {
      console.error(`[gateway] timeout 처리 오류 command=${commandId}:`, err);
    } finally {
      await clearCorrelation(redis, commandId);
    }
  }
}

/** 이미 종결(ack 선처리)된 명령이면 조용히 건너뛰고, 아니면 TIMED_OUT 전이+audit */
async function lockFreeTimeoutTransition(commandId: string): Promise<boolean> {
  try {
    await transitionCommandWithAudit({
      commandId,
      toStatus: "TIMED_OUT",
      reason: "mqtt command ack timeout",
    });
    return true;
  } catch (err) {
    if (err instanceof IllegalCommandTransitionError) return false; // 이미 종결 — 정상
    throw err;
  }
}

async function main(): Promise<void> {
  const url = process.env.MQTT_URL ?? "mqtt://localhost:1883";
  const redis = createRedisCommandClient();
  await redis.connect();
  console.log("[gateway] redis 연결 — command correlation 활성화");

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
    void onMessage(redis, topic, payload);
  });
  client.on("error", (err: Error) => console.error(`[gateway] mqtt error: ${err.message}`));

  const flushTimer = setInterval(() => void flush(), 500);
  const timeoutTimer = setInterval(() => void sweepCommandTimeouts(redis), 1000);

  const shutdown = (): void => {
    clearInterval(flushTimer);
    clearInterval(timeoutTimer);
    void flush().then(() =>
      client.end(false, {}, () =>
        void redis
          .quit()
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
