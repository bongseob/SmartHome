import { z } from "zod";

/**
 * 도메인 enum 단일 소스 (docs/erd.md §4 Enum 목록과 일치).
 * DB(ENUM/CHECK)·API·MQTT payload·시뮬레이터가 모두 이 정의를 재사용한다.
 * 문자열 리터럴을 다른 곳에서 재정의하지 말 것(PROJECT_RULES §1·§11).
 */

export const DeviceCategory = z.enum(["DEVICE", "SENSOR", "GATEWAY", "CAMERA"]);
export type DeviceCategory = z.infer<typeof DeviceCategory>;

/** Floor Map 색상 매핑: ON=녹색 OFF=회색 WARNING=노랑 ALARM=빨강 OFFLINE=검정 */
export const DeviceStatus = z.enum(["ON", "OFF", "WARNING", "ALARM", "OFFLINE"]);
export type DeviceStatus = z.infer<typeof DeviceStatus>;

export const DeviceLifecycle = z.enum([
  "REGISTERED",
  "PROVISIONED",
  "COMMISSIONED",
  "ACTIVE",
  "MAINTENANCE",
  "DECOMMISSIONED",
]);
export type DeviceLifecycle = z.infer<typeof DeviceLifecycle>;

export const CameraProtocol = z.enum(["RTSP", "WEBRTC", "HLS", "ONVIF"]);
export type CameraProtocol = z.infer<typeof CameraProtocol>;

/**
 * Device↔Gateway 구간의 물리/네트워크 연결 방식(SRS 2.1.2·3.1.1, PROJECT_RULES 부록 A.1).
 * Gateway↔플랫폼 구간은 이 값과 무관하게 항상 MQTT다 — 이 enum은 그걸 대체하지 않는다.
 */
export const DeviceConnectionProtocol = z.enum([
  "TCP_IP",
  "SERIAL",
  "MODBUS_TCP",
  "MODBUS_RTU",
  "ZIGBEE",
  "ZWAVE",
]);
export type DeviceConnectionProtocol = z.infer<typeof DeviceConnectionProtocol>;

export const ActorType = z.enum(["ADMIN", "USER", "AI", "SYSTEM"]);
export type ActorType = z.infer<typeof ActorType>;

export const TargetType = z.enum(["DEVICE", "GROUP", "AREA"]);
export type TargetType = z.infer<typeof TargetType>;

/** 명령 수명주기 상태 (SRS 4.3.4) */
export const ExecutionStatus = z.enum([
  "CREATED",
  "PENDING",
  "IN_PROGRESS",
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
]);
export type ExecutionStatus = z.infer<typeof ExecutionStatus>;

export const Role = z.enum(["ADMIN", "USER", "MONITOR", "HITL_APPROVER"]);
export type Role = z.infer<typeof Role>;

export const AccessLevel = z.enum(["VIEW", "CONTROL", "MANAGE"]);
export type AccessLevel = z.infer<typeof AccessLevel>;

export const AlarmTier = z.enum(["REACTIVE", "PROACTIVE", "OPTIMIZATION"]);
export type AlarmTier = z.infer<typeof AlarmTier>;

export const Severity = z.enum(["INFO", "WARNING", "CRITICAL"]);
export type Severity = z.infer<typeof Severity>;

export const AlarmState = z.enum(["RAISED", "ACK", "SNOOZED", "RESOLVED"]);
export type AlarmState = z.infer<typeof AlarmState>;

export const AlarmActionType = z.enum(["ACK", "SNOOZE", "RESOLVE", "NOTE"]);
export type AlarmActionType = z.infer<typeof AlarmActionType>;

export const ChannelType = z.enum(["PUSH", "EMAIL", "SMS", "WEBHOOK"]);
export type ChannelType = z.infer<typeof ChannelType>;

export const ScheduleType = z.enum([
  "ONE_TIME",
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "CRON",
  "EVENT",
]);
export type ScheduleType = z.infer<typeof ScheduleType>;

export const ScheduleRunStatus = z.enum(["FIRED", "SKIPPED", "FAILED"]);
export type ScheduleRunStatus = z.infer<typeof ScheduleRunStatus>;

export const RecommendationType = z.enum([
  "ANOMALY",
  "ENERGY",
  "AWAY",
  "SLEEP",
  "RISK",
]);
export type RecommendationType = z.infer<typeof RecommendationType>;

export const RecommendationStatus = z.enum([
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "EXECUTED",
  "EXPIRED",
]);
export type RecommendationStatus = z.infer<typeof RecommendationStatus>;

export const HitlDecision = z.enum(["APPROVE", "REJECT"]);
export type HitlDecision = z.infer<typeof HitlDecision>;

export const CredentialType = z.enum(["MQTT_PASSWORD", "CLIENT_CERT"]);
export type CredentialType = z.infer<typeof CredentialType>;

export const OtaStatus = z.enum([
  "PENDING",
  "DOWNLOADING",
  "VERIFYING",
  "APPLYING",
  "SUCCESS",
  "FAILED",
  "ROLLED_BACK",
]);
export type OtaStatus = z.infer<typeof OtaStatus>;
