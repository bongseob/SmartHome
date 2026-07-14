import type {
  AlarmState,
  AlarmTier,
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

export interface FloorSummary {
  id: string;
  name: string;
  slug: string;
  buildingName: string;
  buildingSlug: string;
  siteName: string;
  siteSlug: string;
  topicPrefix: string;
  floorMapId: string | null;
  floorMapUrl: string | null;
  floorMapWidth: number | null;
  floorMapHeight: number | null;
  floorMapScale: string | null;
}

export interface ImageRecord {
  id: string;
  name: string;
  imageUrl: string;
  widthPx: number | null;
  heightPx: number | null;
  uploadedAt: string;
}

export interface Area {
  id: string;
  floorId: string;
  name: string;
  slug: string;
  topicPrefix: string;
  /** DB jsonb, 형태는 [[x,y], ...] 를 기대하지만 런타임에 검증한다. */
  polygon: unknown;
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

export interface FloorOverview {
  floor: FloorSummary;
  areas: Area[];
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
