import {
  AckPayload,
  IllegalCommandTransitionError,
  parseTopic,
  StatePayload,
  TelemetryPayload,
  type ExecutionStatus,
  type TargetType,
} from "@smarthome/contracts";
import { connect, publishServiceStatus, serviceWill, type MqttClient } from "@smarthome/mqtt";
import {
  cascadeChildrenOffline,
  closePool,
  compareThreshold,
  completeCommandFromAck,
  findRecentIntentionalStateCommand,
  getDeviceIdByCode,
  getNotificationChannelById,
  insertTelemetryBatch,
  listAlarmPolicies,
  listChannelsForPolicy,
  query,
  raiseAlarmFromPolicy,
  raiseUnexpectedStateChangeAlarm,
  setDeviceStatus,
  sweepDueEscalations,
  transitionCommandWithAudit,
  type AlarmPolicyRecord,
  type TelemetryRow,
} from "@smarthome/db";
import { dispatchNotification } from "@smarthome/notify";
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

// node-redis(v4)는 소켓이 예기치 않게 끊기면(Redis 재기동 등) 내부적으로 'error'를
// 재전파하지 못하고 uncaughtException으로 새는 경우가 있다 — client.on("error", ...)를
// 붙여도 프로세스가 죽을 수 있다는 뜻이다. 재연결은 라이브러리가 기본 전략으로 알아서
// 재시도하므로, 여기서는 로그만 남기고 프로세스를 계속 살려둔다(크래시 방지).
process.on("uncaughtException", (err) => {
  console.error("[gateway] 처리되지 않은 예외(계속 실행):", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[gateway] 처리되지 않은 프로미스 거부(계속 실행):", reason);
});

const dbExecutor = { query };
const INTENTIONAL_STATE_WINDOW_MS = Number(process.env.INTENTIONAL_STATE_WINDOW_MS ?? "30000");

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

function stateCommandSourceLabel(actorType: string): string {
  if (actorType === "SYSTEM") return "스케줄/예약";
  if (actorType === "ADMIN") return "관리자 제어";
  if (actorType === "USER") return "사용자 제어";
  if (actorType === "AI") return "AI 승인 제어";
  return "제어 명령";
}

function stateAlarmSeverity(status: string): "WARNING" | "CRITICAL" {
  return status === "ALARM" ? "CRITICAL" : "WARNING";
}

async function classifyStateChange(
  deviceId: string,
  status: "ON" | "OFF" | "WARNING" | "ALARM" | "OFFLINE",
): Promise<{ origin: "INTENTIONAL" | "FIELD"; label: string; commandId?: string }> {
  const windowMs =
    Number.isFinite(INTENTIONAL_STATE_WINDOW_MS) && INTENTIONAL_STATE_WINDOW_MS > 0
      ? INTENTIONAL_STATE_WINDOW_MS
      : 30000;
  const command = await findRecentIntentionalStateCommand(deviceId, status, windowMs);
  if (!command) return { origin: "FIELD", label: "현장 상태 변화" };
  return {
    origin: "INTENTIONAL",
    label: `${stateCommandSourceLabel(command.actorType)} (${command.commandId})`,
    commandId: command.commandId,
  };
}

// ─── M9 Alarm Service: threshold 평가 + 에스컬레이션 ────────────────────
// deviceId:metric → 해당 기기·지표를 감시하는 활성 정책들 (주기적으로 새로고침)
let policyCache = new Map<string, AlarmPolicyRecord[]>();
// policyId:deviceId → 최초 breach epoch ms (duration_sec 조건 추적, 회복 시 삭제)
const breachSince = new Map<string, number>();

async function refreshAlarmPolicyCache(): Promise<void> {
  try {
    const policies = await listAlarmPolicies(dbExecutor, { enabled: true, targetType: "DEVICE" });
    const next = new Map<string, AlarmPolicyRecord[]>();
    for (const policy of policies) {
      if (!policy.targetId || !policy.metric || !policy.operator || policy.thresholdValue === null) continue;
      const key = `${policy.targetId}:${policy.metric}`;
      const list = next.get(key) ?? [];
      list.push(policy);
      next.set(key, list);
    }
    policyCache = next;
  } catch (err) {
    console.error("[gateway] alarm policy 캐시 갱신 실패:", err);
  }
}

async function notifyPolicyChannels(policyId: string, alarmId: string, alarm: {
  tier: string;
  severity: string;
  message: string | null;
  deviceId: string | null;
}): Promise<void> {
  const channels = await listChannelsForPolicy(dbExecutor, policyId);
  await Promise.all(
    channels.map((channel) =>
      dispatchNotification(channel, {
        alarmId,
        tier: alarm.tier,
        severity: alarm.severity,
        message: alarm.message,
        deviceId: alarm.deviceId,
        escalationLevel: 0,
        ts: Date.now(),
      }),
    ),
  );
}

async function evaluateAlarmPolicies(
  events: RealtimePublisher,
  deviceId: string,
  metric: string,
  value: number,
): Promise<void> {
  const policies = policyCache.get(`${deviceId}:${metric}`);
  if (!policies || policies.length === 0) return;

  for (const policy of policies) {
    const breachKey = `${policy.id}:${deviceId}`;
    const breached = compareThreshold(policy.operator!, value, policy.thresholdValue!);
    if (!breached) {
      breachSince.delete(breachKey);
      continue;
    }

    const durationMs = (policy.durationSec ?? 0) * 1000;
    const firstBreachAt = breachSince.get(breachKey);
    if (firstBreachAt === undefined) {
      breachSince.set(breachKey, Date.now());
      if (durationMs > 0) continue; // 지속시간 조건이 있으면 다음 telemetry에서 재평가
    } else if (Date.now() - firstBreachAt < durationMs) {
      continue; // 아직 지속시간 미달
    }

    try {
      const message = `${metric} ${policy.operator} ${policy.thresholdValue} 위반 (현재값 ${value})`;
      const result = await raiseAlarmFromPolicy({ policy, deviceId, message });
      if (result.raised) {
        console.warn(`[gateway] alarm 발생 policy='${policy.name}' device=${deviceId} value=${value}`);
        await publishRealtimeEvent(events, {
          type: "alarm.raised",
          deviceId,
          tier: result.alarm.tier,
          severity: result.alarm.severity,
          message: result.alarm.message,
          ts: Date.now(),
        });
        await notifyPolicyChannels(policy.id, result.alarm.id, {
          tier: result.alarm.tier,
          severity: result.alarm.severity,
          message: result.alarm.message,
          deviceId,
        });
      }
    } catch (err) {
      console.error(`[gateway] alarm policy 평가 오류 policy=${policy.id} device=${deviceId}:`, err);
    }
  }
}

async function sweepAlarmEscalations(): Promise<void> {
  try {
    const due = await sweepDueEscalations();
    for (const item of due) {
      console.warn(
        `[gateway] alarm ${item.alarm.id} 에스컬레이션 level=${item.level} (raised_at=${item.alarm.raisedAt.toISOString()})`,
      );
      if (item.notifyChannelId) {
        const channel = await getNotificationChannelById(dbExecutor, item.notifyChannelId);
        if (channel) {
          await dispatchNotification(channel, {
            alarmId: item.alarm.id,
            tier: item.alarm.tier,
            severity: item.alarm.severity,
            message: item.alarm.message,
            deviceId: item.alarm.deviceId,
            escalationLevel: item.level,
            ts: Date.now(),
          });
        }
      } else if (item.notifyRole) {
        // 역할 기반 알림 팬아웃(사용자별 채널 결정)은 미구현 — 로그만 남긴다.
        console.log(`[gateway] (stub) 역할 '${item.notifyRole}' 대상 에스컬레이션 알림 — 채널 미구현`);
      }
    }
  } catch (err) {
    console.error("[gateway] 에스컬레이션 sweep 오류:", err);
  }
}

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

/**
 * 감시장비(ESP32 보드 등)가 OFFLINE으로 전이되면, 같은 물리 연결을 공유하는 하위
 * 채널(parent_device_id)들은 더 이상 자기 상태를 갱신할 수 없다 — 화면에 마지막 값이
 * 남아있지 않도록 함께 OFFLINE 처리하고, 실제로 상태가 바뀐 채널마다 개별 기기가
 * 오프라인 됐을 때와 동일하게 realtime 이벤트·알람을 남긴다.
 */
async function cascadeBoardOfflineToChildren(
  events: RealtimePublisher,
  parentDeviceId: string,
  parentDeviceCode: string,
): Promise<void> {
  const children = await cascadeChildrenOffline(parentDeviceId);
  for (const child of children) {
    lastStatus.set(child.code, "OFFLINE");
    await publishRealtimeEvent(events, {
      type: "device.state",
      deviceId: child.deviceId,
      deviceCode: child.code,
      status: "OFFLINE",
      origin: "FIELD",
      originLabel: `상위 감시장비(${parentDeviceCode}) 오프라인 — 연쇄 처리`,
      ts: Date.now(),
    });
    const message = `현장 상태 변화: 상위 감시장비(${parentDeviceCode}) 오프라인으로 연쇄 OFFLINE`;
    const raised = await raiseUnexpectedStateChangeAlarm(child.deviceId, message, "WARNING");
    if (raised) {
      await publishRealtimeEvent(events, {
        type: "alarm.raised",
        deviceId: child.deviceId,
        tier: "REACTIVE",
        severity: "WARNING",
        message,
        ts: Date.now(),
      });
    }
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
      if (typeof value === "number") {
        await evaluateAlarmPolicies(events, id, metric, value);
      }
    }
    return;
  }

  if (parts.suffix === "state") {
    const parsed = StatePayload.safeParse(json);
    if (!parsed.success) return;
    const status = parsed.data.status;
    if (lastStatus.get(parts.device) === status) return; // 변화 없음
    lastStatus.set(parts.device, status);
    const update = await setDeviceStatus(parts.device, status);
    if (!update.deviceId) {
      console.warn(`[gateway] 미등록 device '${parts.device}' — state 무시`);
      return;
    }
    const id = update.deviceId;
    idCache.set(parts.device, id);
    if (!update.changed) return;

    const classification = await classifyStateChange(id, status);
    console.log(`[gateway] state ${parts.device} → ${status} (${classification.label})`);
    {
      await publishRealtimeEvent(events, {
        type: "device.state",
        deviceId: id,
        deviceCode: parts.device,
        status,
        origin: classification.origin,
        originLabel: classification.label,
        ts: Date.now(),
      });
      if (status === "OFFLINE") {
        await cascadeBoardOfflineToChildren(events, id, parts.device);
      }
      if (classification.origin === "FIELD") {
        const message =
          status === "OFFLINE"
            ? "현장 상태 변화: device offline (state/LWT)"
            : `현장 상태 변화: ${parts.device} ${update.previousStatus ?? "UNKNOWN"} → ${status}`;
        const raised = await raiseUnexpectedStateChangeAlarm(id, message, stateAlarmSeverity(status));
        if (!raised) return;
        await publishRealtimeEvent(events, {
          type: "alarm.raised",
          deviceId: id,
          tier: "REACTIVE",
          severity: stateAlarmSeverity(status),
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

  await refreshAlarmPolicyCache();

  const client: MqttClient = connect(url, {
    clientId: "svc:gateway-1",
    will: serviceWill("gateway"),
  });

  client.on("connect", () => {
    const subs = [
      "$share/gw/enterprise/+/+/+/+/+/telemetry",
      "$share/gw/enterprise/+/+/+/+/+/state",
      "$share/gw/enterprise/+/+/+/+/+/cmd/ack",
    ];
    for (const s of subs) {
      client.subscribe(s, { qos: s.endsWith("telemetry") ? 0 : 1 });
    }
    publishServiceStatus(client, "gateway", "ONLINE");
    console.log(`[gateway] ${url} 연결 — 공유구독 시작`);
  });
  client.on("message", (topic: string, payload: Buffer) => {
    void onMessage(redis, events, topic, payload);
  });
  client.on("error", (err: Error) => console.error(`[gateway] mqtt error: ${err.message}`));

  const flushTimer = setInterval(() => void flush(), 500);
  const timeoutTimer = setInterval(() => void sweepCommandTimeouts(redis, events), 1000);
  const policyRefreshTimer = setInterval(() => void refreshAlarmPolicyCache(), 30_000);
  const escalationTimer = setInterval(() => void sweepAlarmEscalations(), 5_000);

  const shutdown = (): void => {
    clearInterval(flushTimer);
    clearInterval(timeoutTimer);
    clearInterval(policyRefreshTimer);
    clearInterval(escalationTimer);
    publishServiceStatus(client, "gateway", "OFFLINE");
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
