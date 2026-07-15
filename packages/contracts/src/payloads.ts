import { z } from "zod";
import { AlarmTier, DeviceStatus, Severity } from "./enums.js";
import { SERVICE_NAMES } from "./topics.js";

/**
 * MQTT payload 스키마 단일 소스 (docs/mqtt-topic-design.md §3).
 * 발행/수신 양측이 이 스키마로 검증한다. 감사 메타데이터는 payload가 아닌
 * MQTT5 User Properties 로 싣는다(userProperties.ts).
 */

const epochMs = z.number().int().nonnegative();

/** 제어 명령 `/cmd` (SRS 3.1.3) */
export const CommandPayload = z.object({
  sessionId: z.string().min(1),
  commandId: z.string().min(1), // 전역 유일 · 멱등성 키
  command: z.string().min(1), // turn_on, turn_off, query_state, ptz_move, ota_update ...
  target: z.string().min(1), // 대상 device code
  timestamp: epochMs,
  args: z.record(z.unknown()).optional(),
});
export type CommandPayload = z.infer<typeof CommandPayload>;

/** 명령 결과 `/cmd/ack` */
export const AckStatus = z.enum(["IN_PROGRESS", "SUCCEEDED", "FAILED"]);
export type AckStatus = z.infer<typeof AckStatus>;

export const AckPayload = z.object({
  commandId: z.string().min(1),
  status: AckStatus,
  reasonCode: z.number().int().optional(), // FAILED 시 MQTT Reason Code
  ts: epochMs,
  deviceId: z.string().min(1),
}).superRefine((value, ctx) => {
  if (value.status === "FAILED" && value.reasonCode === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reasonCode"],
      message: "FAILED ack requires MQTT reasonCode",
    });
  }
});
export type AckPayload = z.infer<typeof AckPayload>;

/** 상태 `/state` (Retained) */
export const StatePayload = z.object({
  status: DeviceStatus,
  ts: epochMs,
  firmwareVersion: z.string().optional(),
});
export type StatePayload = z.infer<typeof StatePayload>;

/** 텔레메트리 `/telemetry` — 다중 지표 1메시지 */
export const TelemetryPayload = z.object({
  ts: epochMs,
  metrics: z.record(z.union([z.number(), z.string()])),
});
export type TelemetryPayload = z.infer<typeof TelemetryPayload>;

/** 알람 `/alarm` */
export const AlarmPayload = z.object({
  alarmId: z.string().optional(),
  tier: AlarmTier,
  severity: Severity,
  message: z.string(),
  ts: epochMs,
  deviceId: z.string().min(1),
});
export type AlarmPayload = z.infer<typeof AlarmPayload>;

/** LWT payload — `/state` 에 OFFLINE 게시 (SRS 4.1.2) */
export const LwtPayload = z.object({
  status: z.literal("OFFLINE"),
  ts: epochMs,
});
export type LwtPayload = z.infer<typeof LwtPayload>;

/** 서비스 프레즌스 payload — platform/service/{service}/status(retained)에 게시 */
export const ServiceStatusPayload = z.object({
  service: z.enum(SERVICE_NAMES),
  status: z.enum(["ONLINE", "OFFLINE"]),
  ts: epochMs,
});
export type ServiceStatusPayload = z.infer<typeof ServiceStatusPayload>;

/** OTA `ota_update` 명령의 args (docs/device-lifecycle-ota.md §4.2) */
export const OtaUpdateArgs = z.object({
  version: z.string().min(1),
  url: z.string().url(),
  sha256: z.string().min(1),
  sig: z.string().min(1),
});
export type OtaUpdateArgs = z.infer<typeof OtaUpdateArgs>;
