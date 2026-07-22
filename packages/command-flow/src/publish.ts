import type { ActorType, Role } from "@smarthome/contracts";
import { CommandPayload, IllegalCommandTransitionError } from "@smarthome/contracts";
import { publish, type DeviceIdentity, type MqttClient } from "@smarthome/mqtt";
import {
  createCommandWithAuditResult,
  getCommandById,
  query,
  transitionCommandWithAudit,
  TERMINAL_STATUSES,
  type CommandRecord,
} from "@smarthome/db";
import {
  clearCorrelation,
  defaultCommandSlaMs,
  storeNewCorrelation,
  updateCorrelationStatus,
  type CommandCorrelationState,
  type RedisCommandClient,
} from "./correlation.js";

const dbExecutor = { query };

export interface PublishDeviceCommandInput {
  commandId: string;
  sessionId: string;
  actorType: ActorType;
  actorId: string | null;
  /** 스케줄러 등 특정 human role이 없는 SYSTEM 액터는 null. */
  role: Role | null;
  /** device.id (audit 대상) — 호출부는 반드시 DB에서 해석한 값 사용 */
  targetId: string;
  /** DB canonical mqtt_topic 에서 도출한 identity — 클라이언트 입력 금지 */
  target: DeviceIdentity;
  command: string;
  args?: Record<string, unknown>;
}

export interface PublishDeviceCommandResult {
  command: CommandRecord;
  published: boolean;
}

/**
 * 명령 발행 단일 소스 (api·gateway·scheduler·HITL 공용).
 * command 생성(CREATED audit) → PENDING audit → Redis correlation → MQTT /cmd 발행
 * → IN_PROGRESS audit. 중복 commandId는 멱등성 재요청으로 보고 재발행하지 않는다.
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

  // PENDING 전이 이후의 모든 단계(Redis correlation 저장, MQTT publish, IN_PROGRESS 전이)는
  // 네트워크/외부 I/O라 실패할 수 있다 — 예전엔 여기서 던지면 FAILED 전이도 audit도 없이
  // 명령이 PENDING에 영구히 고착됐다(코드 리뷰 P1 #5). 실패하면 (가능한 만큼) correlation을
  // 정리하고 FAILED로 명시 전이한 뒤, 원래 에러를 그대로 다시 던져 호출부가 알 수 있게 한다.
  try {
    const correlationStored = await storeNewCorrelation(redis, pendingCorrelation, slaMs + 5000);
    if (!correlationStored) {
      throw new Error(`command correlation already exists: ${input.commandId}`);
    }

    await publish(client, input.target, "cmd", payload, {
      actorId: input.actorId ?? input.actorType,
      sessionId: input.sessionId,
      commandId: input.commandId,
      // MQTT5 User Property는 Role이 항상 필요 — 특정 human role이 없는 SYSTEM 액터(예: 스케줄러)는
      // 그 설정 권한이 ADMIN 전용이라는 점에서 ADMIN으로 표기한다(DB audit_log.role은 null로 정확히 남는다).
      role: input.role ?? "ADMIN",
      requestTimeMs: timestamp,
    });

    let inProgress: CommandRecord;
    try {
      inProgress = await transitionCommandWithAudit({
        commandId: input.commandId,
        toStatus: "IN_PROGRESS",
        reason: "mqtt command published",
      });
    } catch (transitionErr) {
      // 기기가 즉시 ack를 보내면 게이트웨이가 completeCommandFromAck로 PENDING→IN_PROGRESS→
      // terminal까지 먼저 끝낼 수 있다. 그러면 발행측의 이 IN_PROGRESS 전이는 불법(terminal→
      // IN_PROGRESS)이 되어 여기서 throw한다 — 실제로는 명령이 성공했는데 발행측이 이를 실패로
      // 오보하던 문제(코드 리뷰 P1-1). 재조회해서 이미 terminal이면 ack가 이겼다고 보고 성공
      // 취급한다. correlation은 gateway의 ack 처리가 이미 clearCorrelation 했으므로 여기서
      // 다시 건드리지 않는다.
      if (
        transitionErr instanceof IllegalCommandTransitionError &&
        TERMINAL_STATUSES.has(transitionErr.from)
      ) {
        const current = await getCommandById(dbExecutor, input.commandId);
        if (current && TERMINAL_STATUSES.has(current.status)) {
          return { command: current, published: true };
        }
      }
      throw transitionErr;
    }
    await updateCorrelationStatus(
      redis,
      { ...pendingCorrelation, status: "IN_PROGRESS" },
      Math.max(deadlineEpochMs - Date.now() + 5000, 1000),
    );

    return { command: inProgress, published: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    try {
      await clearCorrelation(redis, input.commandId);
    } catch (cleanupErr) {
      console.error(`[command-flow] correlation cleanup 실패 commandId=${input.commandId}:`, cleanupErr);
    }
    try {
      await transitionCommandWithAudit({
        commandId: input.commandId,
        toStatus: "FAILED",
        reason: `publish failed: ${reason}`,
      });
    } catch (transitionErr) {
      console.error(`[command-flow] FAILED 전이 실패 commandId=${input.commandId}:`, transitionErr);
    }
    throw err;
  }
}
