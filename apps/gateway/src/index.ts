import { randomUUID } from "node:crypto";
import {
  AckPayload,
  IllegalCommandTransitionError,
  parseDeviceBase,
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
  getDeviceState,
  getNotificationChannelById,
  insertTelemetryBatch,
  listAlarmPolicies,
  listChannelsForPolicy,
  listDueNotificationRetries,
  markNotificationDelivered,
  markNotificationRetryOrFailed,
  query,
  raiseAlarmFromPolicy,
  raiseUnexpectedStateChangeAlarm,
  recordFailedDelivery,
  setDeviceStatus,
  sweepDueEscalations,
  transitionCommandWithAudit,
  type AlarmPolicyRecord,
  type NotificationChannelRecord,
  type NotificationDeliveryPayload,
  type TelemetryRow,
} from "@smarthome/db";
import { dispatchNotification } from "@smarthome/notify";
import {
  clearCorrelation,
  createRedisCommandClient,
  dueCommandIds,
  getCorrelation,
  publishDeviceCommand,
  updateCorrelationStatus,
  type RedisCommandClient,
} from "@smarthome/command-flow";
import {
  createRealtimePublisher,
  publishRealtimeEvent,
  type RealtimePublisher,
} from "@smarthome/realtime";
import { CameraAdapter } from "./camera-adapter.js";

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

/**
 * dispatchNotification은 동기 재시도까지 실패하면 성공/실패를 명시적으로 반환한다
 * (코드 리뷰 P1 #11 — 예전엔 실패해도 조용히 성공 취급했다). 여기서 실패를
 * notification_delivery에 남겨 배경 재시도(retryPendingNotifications)로 넘긴다.
 */
async function dispatchAndTrackNotification(
  channel: NotificationChannelRecord,
  payload: NotificationDeliveryPayload,
): Promise<void> {
  const result = await dispatchNotification(channel, payload);
  if (result.success) return;
  try {
    await recordFailedDelivery(dbExecutor, {
      alarmId: payload.alarmId,
      channelId: channel.id,
      payload,
      attemptCount: result.attempts,
      error: result.error ?? "unknown error",
    });
  } catch (err) {
    console.error(`[gateway] notification_delivery 기록 실패 channel=${channel.name}:`, err);
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
      dispatchAndTrackNotification(channel, {
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

/**
 * 알람 자동 현장 확인(architecture.md §5-cam, sequence-diagrams.md §8-cam) — policy에
 * linked_camera_id/auto_goto_preset_id가 모두 설정돼 있으면, 일반 PTZ 제어와 완전히 같은
 * 명령 흐름(§4 command-flow)으로 ptz_goto_preset을 발행한다. 카메라가 ONVIF+실카메라
 * (simulated=false)면 camera-adapter.ts가 이 명령을 받아 실제로 이동시킨다.
 */
async function triggerAutoPtzPreset(
  mqtt: MqttClient,
  redis: RedisCommandClient,
  policy: AlarmPolicyRecord,
  alarmId: string,
): Promise<void> {
  if (!policy.linkedCameraId || !policy.autoGotoPresetId) return;
  try {
    const camera = await getDeviceState(dbExecutor, policy.linkedCameraId);
    if (!camera) {
      console.warn(`[gateway] 알람 자동 프리셋 이동 실패 — 카메라 없음: ${policy.linkedCameraId}`);
      return;
    }
    const identity = parseDeviceBase(camera.mqttTopic);
    if (!identity) {
      console.warn(`[gateway] 알람 자동 프리셋 이동 실패 — 잘못된 mqtt_topic: ${camera.code}`);
      return;
    }
    const commandId = `CMD-${Date.now()}-${randomUUID().slice(0, 8)}`;
    await publishDeviceCommand(mqtt, redis, {
      commandId,
      sessionId: `ALARM-${alarmId}`,
      actorType: "SYSTEM",
      actorId: null,
      role: null,
      targetId: camera.id,
      target: identity,
      command: "ptz_goto_preset",
      args: { presetId: policy.autoGotoPresetId },
    });
    console.log(`[gateway] 알람 ${alarmId} → 카메라 ${camera.code} 자동 프리셋 이동(${commandId})`);
  } catch (err) {
    console.error(`[gateway] 알람 자동 프리셋 이동 오류 policy=${policy.id}:`, err);
  }
}

async function evaluateAlarmPolicies(
  mqtt: MqttClient,
  redis: RedisCommandClient,
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
        await triggerAutoPtzPreset(mqtt, redis, policy, result.alarm.id);
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
          await dispatchAndTrackNotification(channel, {
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

/**
 * notification_delivery에 쌓인 PENDING(동기 재시도까지 실패한) 건을 지수 백오프
 * 일정에 따라 재시도한다(코드 리뷰 P1 #11). 별도 워커 프로세스 없이 sweepAlarmEscalations와
 * 같은 폴링 패턴을 재사용 — channel 조회 실패(삭제된 채널 등)는 즉시 FAILED_PERMANENT로
 * 확정해 무한정 sweep에 남지 않게 한다.
 */
async function retryPendingNotifications(): Promise<void> {
  try {
    const due = await listDueNotificationRetries(dbExecutor);
    for (const item of due) {
      const channel = await getNotificationChannelById(dbExecutor, item.channelId);
      if (!channel) {
        await markNotificationRetryOrFailed(dbExecutor, {
          id: item.id,
          attemptCount: item.attemptCount + 1,
          error: `channel ${item.channelId} not found`,
        });
        continue;
      }
      const result = await dispatchNotification(channel, item.payload);
      if (result.success) {
        await markNotificationDelivered(dbExecutor, item.id);
        console.log(`[gateway] notification_delivery ${item.id} 배경 재시도 성공(channel=${channel.name})`);
      } else {
        await markNotificationRetryOrFailed(dbExecutor, {
          id: item.id,
          attemptCount: item.attemptCount + 1,
          error: result.error ?? "unknown error",
        });
      }
    }
  } catch (err) {
    console.error("[gateway] notification_delivery 재시도 sweep 오류:", err);
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
  mqtt: MqttClient,
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
        await evaluateAlarmPolicies(mqtt, redis, events, id, metric, value);
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
  const cameraAdapter = new CameraAdapter(client);

  client.on("connect", () => {
    const subs = [
      "$share/gw/enterprise/+/+/+/+/+/telemetry",
      "$share/gw/enterprise/+/+/+/+/+/state",
      "$share/gw/enterprise/+/+/+/+/+/cmd/ack",
      // ONVIF 카메라 PTZ 어댑터용(§camera-adapter). 다른 기기의 cmd는 device-simulator/실기기가
      // 직접 구독해 응답하므로, 게이트웨이는 지금까지 cmd 자체를 구독하지 않았다 — 카메라만 예외.
      "$share/gw/enterprise/+/+/+/+/+/cmd",
    ];
    for (const s of subs) {
      client.subscribe(s, { qos: s.endsWith("telemetry") ? 0 : 1 });
    }
    publishServiceStatus(client, "gateway", "ONLINE");
    console.log(`[gateway] ${url} 연결 — 공유구독 시작`);
  });
  client.on("message", (topic: string, payload: Buffer) => {
    void onMessage(client, redis, events, topic, payload);
    void cameraAdapter.handleMessage(topic, payload);
  });
  client.on("error", (err: Error) => console.error(`[gateway] mqtt error: ${err.message}`));

  const flushTimer = setInterval(() => void flush(), 500);
  const timeoutTimer = setInterval(() => void sweepCommandTimeouts(redis, events), 1000);
  const policyRefreshTimer = setInterval(() => void refreshAlarmPolicyCache(), 30_000);
  const escalationTimer = setInterval(() => void sweepAlarmEscalations(), 5_000);
  // 백오프 최소 단위(1분)보다 촘촘히 돌 필요는 없다 — listDueNotificationRetries가
  // next_retry_at <= now()만 골라오므로 더 자주 돌아도 실제 재시도 빈도는 그대로다.
  const notificationRetryTimer = setInterval(() => void retryPendingNotifications(), 30_000);

  const shutdown = (): void => {
    clearInterval(flushTimer);
    clearInterval(timeoutTimer);
    clearInterval(policyRefreshTimer);
    clearInterval(escalationTimer);
    clearInterval(notificationRetryTimer);
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
