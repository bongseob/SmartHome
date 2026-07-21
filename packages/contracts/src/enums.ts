import { z } from "zod";

/**
 * 도메인 enum 단일 소스 (docs/erd.md §4 Enum 목록과 일치).
 * DB(ENUM/CHECK)·API·MQTT payload·시뮬레이터가 모두 이 정의를 재사용한다.
 * 문자열 리터럴을 다른 곳에서 재정의하지 말 것(PROJECT_RULES §1·§11).
 */

export const DeviceCategory = z.enum(["DEVICE", "SENSOR", "GATEWAY", "CAMERA"]);
export type DeviceCategory = z.infer<typeof DeviceCategory>;

/** 기기 관리 운영 모델: 통신/제어 단위인 감시장비와 그 하위 개별 센서를 분리한다. */
export const DeviceRole = z.enum(["MONITORING_EQUIPMENT", "SENSOR"]);
export type DeviceRole = z.infer<typeof DeviceRole>;

/** 센서 값 형태. 디지털은 ON/OFF류, 아날로그는 수치/연속값류를 의미한다. */
export const SensorSignalType = z.enum(["DIGITAL", "ANALOG"]);
export type SensorSignalType = z.infer<typeof SensorSignalType>;

/** 감시장비 채널 I/O 유형. 레거시 DI/DO/AI/AO 표기를 그대로 수용한다. */
export const SensorIoType = z.enum(["DI", "DO", "AI", "AO"]);
export type SensorIoType = z.infer<typeof SensorIoType>;

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

/**
 * 알람 통지 발송 결과 추적(코드 리뷰 P1 #11 — 발송 실패가 조용히 사라지던 문제).
 * PENDING: 즉시 재시도까지 실패해 배경 재시도 대기 중. DELIVERED: 발송 성공.
 * FAILED_PERMANENT: 재시도 한도 초과 — 운영자가 확인해야 한다.
 */
export const NotificationDeliveryStatus = z.enum(["PENDING", "DELIVERED", "FAILED_PERMANENT"]);
export type NotificationDeliveryStatus = z.infer<typeof NotificationDeliveryStatus>;

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
  /** 승인 커밋 후 실제 제어(MQTT) 발행이 실패한 상태 — 코드 리뷰 P1 #4. 예전엔 발행 실패 시
   *  APPROVED에 영구히 멈춰 재승인도 재시도도 못 했다. 운영자가 재시도(POST retry-dispatch)로
   *  EXECUTED까지 복구시킬 수 있다. */
  "DISPATCH_FAILED",
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

/**
 * 조명/부하 제어 도메인 (docs/srs-lighting-control-addendum.md).
 * 레거시 차단기 조명제어 시스템을 범용화해 추가한 enum들.
 */

/** 부하 구분(레거시 조명구분). RESERVE(예비)는 관제 화면에 표시하지 않는다(addendum §3.2). */
export const LoadClass = z.enum(["NORMAL", "EMERGENCY", "RESERVE"]);
export type LoadClass = z.infer<typeof LoadClass>;

/** 휴일 음/양력 구분(addendum §7). LUNAR는 스케줄 판정 시 해당 연도 양력으로 변환한다. */
export const LunarSolar = z.enum(["SOLAR", "LUNAR"]);
export type LunarSolar = z.infer<typeof LunarSolar>;

/** Area 유형(addendum §2.3). PANEL = 분전반형(배경이미지·좌표), ROOM = 일반 공간. */
export const AreaKind = z.enum(["ROOM", "PANEL"]);
export type AreaKind = z.infer<typeof AreaKind>;
