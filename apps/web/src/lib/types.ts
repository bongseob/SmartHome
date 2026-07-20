import type {
  AlarmState,
  AlarmTier,
  AreaKind,
  DeviceCategory,
  DeviceLifecycle,
  DeviceRole,
  DeviceStatus,
  ExecutionStatus,
  HitlDecision,
  LoadClass,
  RecommendationStatus,
  RecommendationType,
  Role,
  ScheduleRunStatus,
  ScheduleType,
  SensorIoType,
  SensorSignalType,
  Severity,
  TargetType,
} from "@smarthome/contracts";

export interface AuthUser {
  id: string;
  username: string;
  roles: Role[];
  topics: string[];
}
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}

/** 층 태그 — 전체 모니터링 층별 집계 + 지역 생성 시 층 선택 콤보박스용(2026-07-15 합의, floor는
 *  area가 공유하는 메타 태그일 뿐이다). */
export interface FloorSummary {
  id: string;
  name: string;
  slug: string;
  buildingName: string;
  buildingSlug: string;
  siteName: string;
  siteSlug: string;
  topicPrefix: string;
}

export interface ImageRecord {
  id: string;
  name: string;
  /** 이 이미지가 어떤 용도로 쓰이는지 남기는 부연 설명(예: "1층 로비 배경"). area 배경 외에
   *  다른 것의 배경으로도 재사용될 수 있어, 용도 파악을 돕는 자유 텍스트다. */
  description: string | null;
  imageUrl: string;
  widthPx: number | null;
  heightPx: number | null;
  uploadedAt: string;
}

/** "지역" — 사용자 관점 1차 관리 단위(2026-07-15 합의). floor는 여러 지역이 공유하는 층
 *  태그일 뿐이고, 배경 이미지는 지역이 직접 가진다(imageId/imageUrl). */
export interface AreaSummary {
  id: string;
  name: string;
  slug: string;
  kind: AreaKind;
  floorId: string;
  floorName: string;
  buildingName: string;
  siteName: string;
  topicPrefix: string; // "enterprise/site1/bldg-a/2f/living-room"
  imageId: string | null;
  imageUrl: string | null;
  imageWidthPx: number | null;
  imageHeightPx: number | null;
}

export interface DeviceListItem {
  id: string;
  code: string;
  name: string;
  category: DeviceCategory;
  deviceRole: DeviceRole;
  deviceType: string | null;
  manufacturer: string | null;
  model: string | null;
  firmwareVersion: string | null;
  mqttTopic: string;
  currentStatus: DeviceStatus;
  lifecycleStatus: DeviceLifecycle;
  monitoringVisible: boolean;
  enabled: boolean;
  /** true(기본)면 device-simulator MockResponder가 이 기기의 cmd를 대신 응답 중이다 —
   *  즉 실기기가 아니라 가상 기기 상태. 실기기를 연결하면 false로 바꾼다. */
  simulated: boolean;
  parentDeviceId: string | null;
  sensorSignalType: SensorSignalType | null;
  sensorIoType: SensorIoType | null;
  channelAddress: string | null;
  terminalBlock: string | null;
  loadClass: LoadClass | null;
  description: string | null;
  areaId: string | null;
  areaTopicPrefix: string | null;
  posX: string | null;
  posY: string | null;
  gatewayId: string | null;
  connectionProtocol: string | null;
  connectionConfig: unknown;
  /** 사용자 지정 이미지(image 라이브러리 참조) — area의 imageId/imageUrl과 동일 패턴. */
  imageId: string | null;
  imageUrl: string | null;
  updatedAt: string;
}

// ─── 알람 (현장 상태변화 등) ───────────────────────────────────────────

export interface AlarmRecord {
  id: string;
  policyId: string | null;
  deviceId: string | null;
  tier: AlarmTier;
  severity: Severity;
  message: string | null;
  state: AlarmState;
  raisedAt: string;
  snoozedUntil: string | null;
  resolvedAt: string | null;
  escalatedLevel: number;
  areaTopicPrefix: string | null;
}

// ─── 기기 등록/설정 (M16 Admin — ADMIN 전용) ──────────────────────────

export interface CreateDeviceRequest {
  code: string;
  name: string;
  category: string;
  deviceRole?: DeviceRole;
  deviceType?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  firmwareVersion?: string | null;
  areaId: string;
  gatewayId?: string | null;
  parentDeviceId?: string | null;
  sensorSignalType?: SensorSignalType | null;
  sensorIoType?: SensorIoType | null;
  channelAddress?: string | null;
  terminalBlock?: string | null;
  loadClass?: LoadClass | null;
  description?: string | null;
}

export interface UpdateDeviceRequest {
  name?: string;
  deviceType?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  firmwareVersion?: string | null;
  gatewayId?: string | null;
  parentDeviceId?: string | null;
  sensorSignalType?: SensorSignalType | null;
  sensorIoType?: SensorIoType | null;
  channelAddress?: string | null;
  terminalBlock?: string | null;
  loadClass?: LoadClass | null;
  description?: string | null;
  imageId?: string | null;
}

export interface SetDeviceConnectionRequest {
  /** null이면 설정 해제(레거시/직결 MQTT 기기로 되돌림). */
  protocol: string | null;
  config?: unknown;
}

export interface SetDeviceMonitoringRequest {
  monitoringVisible?: boolean;
  enabled?: boolean;
}

export interface SetDeviceSimulatedRequest {
  simulated: boolean;
}

/** 관제 화면(FloorMap)용 — 지역 1개의 배경 이미지 + 기기 목록. */
export interface AreaOverview {
  area: AreaSummary;
  devices: DeviceListItem[];
}

export interface DeviceHistoryItem {
  kind: "COMMAND" | "AUDIT" | "ALARM";
  [key: string]: unknown;
}

export interface DeviceHistory {
  device: { id: string; code: string; name: string; currentStatus: DeviceStatus };
  commands: DeviceHistoryItem[];
  audits: DeviceHistoryItem[];
  alarms: DeviceHistoryItem[];
}

export interface CommandCreateResponse {
  commandId: string;
  status: ExecutionStatus;
  published?: boolean;
}

export interface CommandRecord {
  commandId: string;
  status: ExecutionStatus;
  targetId: string;
  command: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface GroupControlSummary {
  id: string;
  slug: string;
  name: string;
  isDynamic: boolean;
  totalCount: number;
  onCount: number;
  offCount: number;
  unknownCount: number;
}

export interface GroupCommandItem {
  deviceId: string;
  commandId?: string;
  status?: ExecutionStatus;
  published?: boolean;
  error?: string;
}

export interface GroupCommandResponse {
  groupId: string;
  command: string;
  intervalMs: number;
  count: number;
  results: GroupCommandItem[];
}

// ─── Scheduler (M16 Admin — SRS 2.1.4, 백엔드는 M10에서 완료) ────────────

export interface SchedulerRecord {
  id: string;
  name: string;
  targetType: TargetType;
  targetId: string;
  scheduleType: ScheduleType;
  /** ISO string. ONE_TIME은 발화 시각 전체, DAILY/WEEKLY/MONTHLY는 시각(시:분:초, UTC)만 사용된다. */
  runAt: string | null;
  cronExpr: string | null;
  /** WEEKLY 전용. UTC 기준 요일(0=일 ~ 6=토). */
  daysOfWeek: number[] | null;
  /** MONTHLY 전용. 해당 월 일수를 넘으면 말일로 취급된다. */
  dayOfMonth: number | null;
  eventTrigger: unknown;
  payload: { command?: string; args?: Record<string, unknown> };
  enabled: boolean;
  /** true면 다운타임 중 놓친 발화도 재기동 후 최대 10분까지 실행한다(기본 false=cron과 동일). */
  catchUpEnabled: boolean;
}

export interface CreateSchedulerRequest {
  name: string;
  targetType: TargetType;
  targetId: string;
  scheduleType: ScheduleType;
  runAt?: string;
  cronExpr?: string;
  daysOfWeek?: number[];
  dayOfMonth?: number;
  payload: { command: string; args?: Record<string, unknown> };
  catchUpEnabled?: boolean;
}

export interface ScheduleRunRecord {
  id: string;
  schedulerId: string;
  firedAt: string;
  commandId: string | null;
  status: ScheduleRunStatus;
}

// ─── 시스템 기본정보 (M16 Admin — Site/Building 이름 수정만) ─────────────

export interface SiteRecord {
  id: string;
  slug: string;
  name: string;
}

export interface BuildingRecord {
  id: string;
  siteId: string;
  slug: string;
  name: string;
}

export interface SystemSettingRecord {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: string;
}

// ─── AI 추천 · HITL 승인 (SRS 3.5) ────────────────────────────────────

export interface RecommendationRecord {
  id: string;
  type: RecommendationType;
  targetType: TargetType;
  targetId: string;
  proposedCommand: string;
  proposedPayload: unknown;
  confidenceScore: number;
  requiresHitl: boolean;
  status: RecommendationStatus;
  modelVersion: string | null;
  commandId: string | null;
  createdAt: string;
}

export interface CreateRecommendationRequest {
  type: RecommendationType;
  targetType: "DEVICE";
  targetId: string;
  proposedCommand: string;
  proposedPayload?: unknown;
  confidenceScore: number;
  modelVersion?: string | null;
}

export interface RecommendationDecisionRequest {
  decision: HitlDecision;
  reason?: string | null;
}
