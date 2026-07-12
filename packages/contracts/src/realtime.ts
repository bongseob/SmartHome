import { z } from "zod";
import { AlarmState, AlarmTier, DeviceStatus, ExecutionStatus, Severity, TargetType } from "./enums.js";

/**
 * 대시보드 실시간 이벤트 스키마 (docs/architecture.md §11, docs/api-spec.md §10 /ws/realtime).
 * gateway가 Redis pub/sub로 발행하고, api가 구독해 WebSocket으로 중계한다.
 * 단일 채널(REALTIME_CHANNEL)에 discriminated union으로 실어 보낸다.
 */

const epochMs = z.number().int().nonnegative();

export const DeviceStateEvent = z.object({
  type: z.literal("device.state"),
  deviceId: z.string(),
  deviceCode: z.string(),
  status: DeviceStatus,
  origin: z.enum(["INTENTIONAL", "FIELD"]).optional(),
  originLabel: z.string().optional(),
  ts: epochMs,
});
export type DeviceStateEvent = z.infer<typeof DeviceStateEvent>;

export const AlarmRaisedEvent = z.object({
  type: z.literal("alarm.raised"),
  deviceId: z.string().nullable(),
  tier: AlarmTier,
  severity: Severity,
  message: z.string().nullable(),
  ts: epochMs,
});
export type AlarmRaisedEvent = z.infer<typeof AlarmRaisedEvent>;

export const CommandStatusEvent = z.object({
  type: z.literal("command.status"),
  commandId: z.string(),
  status: ExecutionStatus,
  targetType: TargetType,
  targetId: z.string(),
  ts: epochMs,
});
export type CommandStatusEvent = z.infer<typeof CommandStatusEvent>;

/** 알람 ack/snooze/resolve 등 상태 전이(M9). 최초 발생은 AlarmRaisedEvent, 이후 상태 변화는 이 이벤트. */
export const AlarmUpdatedEvent = z.object({
  type: z.literal("alarm.updated"),
  alarmId: z.string(),
  deviceId: z.string().nullable(),
  state: AlarmState,
  ts: epochMs,
});
export type AlarmUpdatedEvent = z.infer<typeof AlarmUpdatedEvent>;

export const RealtimeEvent = z.discriminatedUnion("type", [
  DeviceStateEvent,
  AlarmRaisedEvent,
  CommandStatusEvent,
  AlarmUpdatedEvent,
]);
export type RealtimeEvent = z.infer<typeof RealtimeEvent>;

/** Redis pub/sub 채널명 단일 소스 */
export const REALTIME_CHANNEL = "smarthome:events";
