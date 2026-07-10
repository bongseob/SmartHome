import type {
  DeviceCategory,
  DeviceLifecycle,
  DeviceStatus,
  ExecutionStatus,
  Role,
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
  deviceType: string | null;
  manufacturer: string | null;
  model: string | null;
  firmwareVersion: string | null;
  mqttTopic: string;
  currentStatus: DeviceStatus;
  lifecycleStatus: DeviceLifecycle;
  areaId: string | null;
  areaTopicPrefix: string | null;
  posX: string | null;
  posY: string | null;
  updatedAt: string;
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
