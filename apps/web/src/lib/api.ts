import type {
  AlarmRecord,
  AreaOverview,
  AreaSummary,
  AuthUser,
  BuildingRecord,
  CameraPresetRecord,
  CameraStreamResponse,
  CameraSummary,
  CommandCreateResponse,
  CommandRecord,
  CreateCameraPresetRequest,
  CreateCameraRequest,
  CreateDeviceRequest,
  CreateRecommendationRequest,
  CreateSchedulerRequest,
  DeviceHistory,
  DeviceListItem,
  FloorSummary,
  GroupCommandResponse,
  GroupControlSummary,
  ImageRecord,
  RecommendationDecisionRequest,
  RecommendationRecord,
  ScheduleRunRecord,
  SchedulerRecord,
  SetDeviceConnectionRequest,
  SetDeviceMonitoringRequest,
  SetDeviceSimulatedRequest,
  SiteRecord,
  PtzMoveRequest,
  SystemSettingRecord,
  TokenPair,
  UpdateCameraRequest,
  UpdateDeviceRequest,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";

const STORAGE_KEY = "smarthome.auth";
const ACCESS_REFRESH_SKEW_MS = 30_000;

interface StoredAuth {
  tokens: TokenPair;
  user: AuthUser;
}

export class AuthExpiredError extends Error {
  constructor() {
    super("session expired");
    this.name = "AuthExpiredError";
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

function readStoredAuth(): StoredAuth | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
}

function writeStoredAuth(auth: StoredAuth): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
}

function clearStoredAuth(): void {
  localStorage.removeItem(STORAGE_KEY);
}

function jwtExpiresAtMs(token: string): number | null {
  const [, encodedPayload] = token.split(".");
  if (!encodedPayload) return null;
  try {
    const base64 = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64)) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function shouldRefreshAccessToken(auth: StoredAuth): boolean {
  const expiresAt = jwtExpiresAtMs(auth.tokens.accessToken);
  return expiresAt !== null && expiresAt - Date.now() <= ACCESS_REFRESH_SKEW_MS;
}

export function getSession(): StoredAuth | null {
  return readStoredAuth();
}

async function parseProblemDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  // FormData(파일 업로드)는 브라우저가 boundary를 포함한 Content-Type을 직접 설정해야 한다 —
  // 여기서 application/json을 강제하면 멀티파트 파싱이 깨진다.
  const isFormData = init.body instanceof FormData;
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: isFormData ? init.headers : { "Content-Type": "application/json", ...init.headers },
  });
}

/** 상대 경로(예: 로컬 업로드된 도면 이미지 "/uploads/...")는 API 서버 기준으로 절대화한다.
 *  이미 절대 URL(seed의 placeholder 등)이면 그대로 둔다. */
export function apiAssetUrl(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path}`;
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const response = await rawFetch("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    throw new ApiError(response.status, await parseProblemDetail(response));
  }
  const body = (await response.json()) as TokenPair & { user: AuthUser };
  const { user, ...tokens } = body;
  writeStoredAuth({ tokens, user });
  return user;
}

let inFlightRefresh: Promise<StoredAuth> | null = null;

/** refresh token은 1회용(회전)이라 동시 401이 겹쳐도 실제 호출은 하나만 나가야 한다. */
function refreshSession(): Promise<StoredAuth> {
  if (inFlightRefresh) return inFlightRefresh;

  inFlightRefresh = (async () => {
    const current = readStoredAuth();
    if (!current) throw new AuthExpiredError();
    const response = await rawFetch("/api/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken: current.tokens.refreshToken }),
    });
    if (!response.ok) {
      clearStoredAuth();
      throw new AuthExpiredError();
    }
    const body = (await response.json()) as TokenPair & { user: AuthUser };
    const { user, ...tokens } = body;
    const next: StoredAuth = { tokens, user };
    writeStoredAuth(next);
    return next;
  })();

  return inFlightRefresh.finally(() => {
    inFlightRefresh = null;
  });
}

export async function logout(): Promise<void> {
  const current = readStoredAuth();
  clearStoredAuth();
  if (!current) return;
  try {
    await rawFetch("/api/v1/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken: current.tokens.refreshToken }),
    });
  } catch {
    // 서버 호출 실패해도 로컬 세션은 이미 정리됨 — 무시
  }
}

/** 인증이 필요한 API 호출. 401을 만나면 refresh 1회 후 재시도하고, 그래도 실패하면 로그아웃 처리한다. */
async function authedFetch(path: string, init: RequestInit = {}, isRetry = false): Promise<Response> {
  let current = readStoredAuth();
  if (!current) throw new AuthExpiredError();

  if (!isRetry && shouldRefreshAccessToken(current)) {
    current = await refreshSession();
  }

  const response = await rawFetch(path, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${current.tokens.accessToken}` },
  });

  if (response.status !== 401 || isRetry) {
    return response;
  }

  await refreshSession();
  return authedFetch(path, init, true);
}

async function authedJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await authedFetch(path, init);
  if (!response.ok) {
    throw new ApiError(response.status, await parseProblemDetail(response));
  }
  return (await response.json()) as T;
}

/** 층 태그 목록 — 전체 모니터링 층별 집계 + 지역 생성 시 층 선택 콤보박스용. */
export function listFloors(): Promise<FloorSummary[]> {
  return authedJson<FloorSummary[]>("/api/v1/spatial/floors");
}

/** "지역" 목록 — 관제/기기관리/지역관리의 1차 탐색 단위(2026-07-15 합의). */
export function listAreas(): Promise<AreaSummary[]> {
  return authedJson<AreaSummary[]>("/api/v1/spatial/areas");
}

/** 지역 생성 — floorId(기존 층 태그) 또는 floorName(새 층 태그) 중 하나를 준다(ADMIN 전용). */
export function createArea(body: { name: string; floorId?: string; floorName?: string }): Promise<AreaSummary> {
  return authedJson<AreaSummary>("/api/v1/spatial/areas", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** 지역 이름 변경, 배경 이미지 지정(imageId) 등. imageId를 null로 주면 배경을 해제한다. */
export function updateArea(
  areaId: string,
  body: { name?: string; imageId?: string | null },
): Promise<AreaSummary> {
  return authedJson<AreaSummary>(`/api/v1/spatial/areas/${areaId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteArea(areaId: string): Promise<{ deleted: true }> {
  return authedJson<{ deleted: true }>(`/api/v1/spatial/areas/${areaId}`, { method: "DELETE" });
}

/** 활성 알람(RAISED)만 조회 — 현장 상태변화 등. 확인(ack) 전까지 유지된다. */
export function listActiveAlarms(): Promise<AlarmRecord[]> {
  return authedJson<AlarmRecord[]>("/api/v1/alarms?state=RAISED");
}

/** 알람 확인(담당자/관리자) — RAISED → ACK. 확인 시에만 알람이 멈춘다(자동 해제 없음). */
export function acknowledgeAlarm(id: string): Promise<AlarmRecord> {
  return authedJson<AlarmRecord>(`/api/v1/alarms/${id}/ack`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/** 관제 화면(FloorMap)용 — 지역 1개의 배경 이미지 + 기기 목록. */
export function getAreaOverview(areaId: string): Promise<AreaOverview> {
  return authedJson<AreaOverview>(`/api/v1/spatial/areas/${areaId}/overview`);
}

export interface LayoutPosition {
  deviceId: string;
  posX: number;
  posY: number;
}

/** 도면 편집 모드 — 변경된 기기 좌표 일괄 저장(ADMIN 전용, 서버에서 DEVICE_RELOCATE 감사). */
export function saveAreaLayout(areaId: string, positions: LayoutPosition[]): Promise<unknown> {
  return authedJson(`/api/v1/spatial/areas/${areaId}/layout`, {
    method: "PATCH",
    body: JSON.stringify({ positions }),
  });
}

export function listDevices(filter?: {
  areaId?: string;
  category?: string;
  status?: string;
}): Promise<DeviceListItem[]> {
  const params = new URLSearchParams();
  if (filter?.areaId) params.set("areaId", filter.areaId);
  if (filter?.category) params.set("category", filter.category);
  if (filter?.status) params.set("status", filter.status);
  const qs = params.toString();
  return authedJson<DeviceListItem[]>(`/api/v1/devices${qs ? `?${qs}` : ""}`);
}

export function getDeviceHistory(deviceId: string, limit = 20): Promise<DeviceHistory> {
  return authedJson<DeviceHistory>(`/api/v1/devices/${deviceId}/history?limit=${limit}`);
}

// ─── 기기 등록/설정 (M16 Admin — ADMIN 전용) ──────────────────────────

export function createDevice(body: CreateDeviceRequest): Promise<DeviceListItem> {
  return authedJson<DeviceListItem>("/api/v1/devices", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateDevice(id: string, body: UpdateDeviceRequest): Promise<DeviceListItem> {
  return authedJson<DeviceListItem>(`/api/v1/devices/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function decommissionDevice(id: string): Promise<DeviceListItem> {
  return authedJson<DeviceListItem>(`/api/v1/devices/${id}/decommission`, {
    method: "PATCH",
  });
}

export function setDeviceConnection(
  id: string,
  body: SetDeviceConnectionRequest,
): Promise<DeviceListItem> {
  return authedJson<DeviceListItem>(`/api/v1/devices/${id}/connection`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function setDeviceMonitoring(
  id: string,
  body: SetDeviceMonitoringRequest,
): Promise<DeviceListItem> {
  return authedJson<DeviceListItem>(`/api/v1/devices/${id}/monitoring`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function setDeviceSimulated(
  id: string,
  body: SetDeviceSimulatedRequest,
): Promise<DeviceListItem> {
  return authedJson<DeviceListItem>(`/api/v1/devices/${id}/simulated`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function createCommand(
  command: string,
  targetDeviceId: string,
): Promise<CommandCreateResponse> {
  return authedJson<CommandCreateResponse>("/api/v1/commands", {
    method: "POST",
    body: JSON.stringify({ command, target: { id: targetDeviceId } }),
  });
}

export function createGroupCommand(
  command: string,
  targetGroupId: string,
): Promise<GroupCommandResponse> {
  return authedJson<GroupCommandResponse>("/api/v1/commands/group", {
    method: "POST",
    body: JSON.stringify({ command, target: { id: targetGroupId, type: "GROUP" } }),
  });
}

export function getCommand(commandId: string): Promise<CommandRecord> {
  return authedJson<CommandRecord>(`/api/v1/commands/${commandId}`);
}

export function listGroupControlSummaries(): Promise<GroupControlSummary[]> {
  return authedJson<GroupControlSummary[]>("/api/v1/groups/control");
}

export function listGroupControlDevices(groupId: string): Promise<DeviceListItem[]> {
  return authedJson<DeviceListItem[]>(`/api/v1/groups/${groupId}/devices`);
}

// ─── Scheduler (M16 Admin — ADMIN 전용, 서버가 최종 검증) ─────────────────

export function listSchedulers(): Promise<SchedulerRecord[]> {
  return authedJson<SchedulerRecord[]>("/api/v1/schedulers");
}

export function createScheduler(body: CreateSchedulerRequest): Promise<SchedulerRecord> {
  return authedJson<SchedulerRecord>("/api/v1/schedulers", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateScheduler(id: string, body: CreateSchedulerRequest): Promise<SchedulerRecord> {
  return authedJson<SchedulerRecord>(`/api/v1/schedulers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function setSchedulerEnabled(id: string, enabled: boolean): Promise<SchedulerRecord> {
  return authedJson<SchedulerRecord>(`/api/v1/schedulers/${id}/enabled`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export function deleteScheduler(id: string): Promise<{ deleted: true }> {
  return authedJson<{ deleted: true }>(`/api/v1/schedulers/${id}`, { method: "DELETE" });
}

export function getSchedulerRuns(id: string, limit = 20): Promise<ScheduleRunRecord[]> {
  return authedJson<ScheduleRunRecord[]>(`/api/v1/schedulers/${id}/runs?limit=${limit}`);
}

// ─── 시스템 기본정보 (M16 Admin — ADMIN 전용, Site/Building 이름 수정만) ──

export function listSites(): Promise<SiteRecord[]> {
  return authedJson<SiteRecord[]>("/api/v1/spatial/sites");
}

export function updateSiteName(id: string, name: string): Promise<SiteRecord> {
  return authedJson<SiteRecord>(`/api/v1/spatial/sites/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function listBuildings(): Promise<BuildingRecord[]> {
  return authedJson<BuildingRecord[]>("/api/v1/spatial/buildings");
}

export function updateBuildingName(id: string, name: string): Promise<BuildingRecord> {
  return authedJson<BuildingRecord>(`/api/v1/spatial/buildings/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

/** 로그인 화면·브라우저 탭 제목용 — 인증 없이 조회(health와 동일 성격의 공개 엔드포인트). */
export async function getSystemName(): Promise<string> {
  const response = await rawFetch("/api/v1/system-settings/name", { method: "GET" });
  if (!response.ok) throw new ApiError(response.status, await parseProblemDetail(response));
  const body = (await response.json()) as { name: string };
  return body.name;
}

export function listSystemSettings(): Promise<SystemSettingRecord[]> {
  return authedJson<SystemSettingRecord[]>("/api/v1/system-settings");
}

export function updateSystemSetting(key: string, value: unknown): Promise<SystemSettingRecord> {
  return authedJson<SystemSettingRecord>(`/api/v1/system-settings/${key}`, {
    method: "PATCH",
    body: JSON.stringify({ value }),
  });
}

// ─── 이미지 라이브러리 (등록 후 지역의 배경으로 updateArea(imageId)로 매핑) ──

export function listImages(): Promise<ImageRecord[]> {
  return authedJson<ImageRecord[]>("/api/v1/images");
}

export function uploadImage(
  file: File,
  meta: { name: string; description?: string; widthPx: number; heightPx: number },
): Promise<ImageRecord> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("name", meta.name);
  if (meta.description !== undefined) formData.append("description", meta.description);
  formData.append("widthPx", String(meta.widthPx));
  formData.append("heightPx", String(meta.heightPx));
  return authedFetch("/api/v1/images", {
    method: "POST",
    body: formData,
  }).then(async (response) => {
    if (!response.ok) throw new ApiError(response.status, await parseProblemDetail(response));
    return (await response.json()) as ImageRecord;
  });
}

/** 이름/설명 수정 및/또는 파일 교체 — id(키)는 유지된다. file을 생략하면 파일은 그대로다.
 *  같은 이미지를 배경으로 참조하는 area 등은 이 id를 그대로 쓰므로 다시 매핑할 필요가 없다. */
export function updateImage(
  id: string,
  input: { name?: string; description?: string; file?: File; widthPx?: number; heightPx?: number },
): Promise<ImageRecord> {
  const formData = new FormData();
  if (input.name !== undefined) formData.append("name", input.name);
  if (input.description !== undefined) formData.append("description", input.description);
  if (input.file) formData.append("file", input.file);
  if (input.widthPx !== undefined) formData.append("widthPx", String(input.widthPx));
  if (input.heightPx !== undefined) formData.append("heightPx", String(input.heightPx));
  return authedFetch(`/api/v1/images/${id}`, {
    method: "PATCH",
    body: formData,
  }).then(async (response) => {
    if (!response.ok) throw new ApiError(response.status, await parseProblemDetail(response));
    return (await response.json()) as ImageRecord;
  });
}

export function deleteImage(id: string): Promise<{ deleted: true }> {
  return authedJson<{ deleted: true }>(`/api/v1/images/${id}`, { method: "DELETE" });
}

export function wsUrl(): string {
  const base = import.meta.env.VITE_WS_BASE ?? API_BASE.replace(/^http/, "ws");
  const token = readStoredAuth()?.tokens.accessToken ?? "";
  return `${base}/ws/realtime?token=${encodeURIComponent(token)}`;
}

export interface SystemStatus {
  api: { status: "ok" | "error" };
  mqtt: { status: "ok" | "error" };
  redis: { status: "ok" | "error" };
  gateway: { status: "ok" | "error" };
  scheduler: { status: "ok" | "error" };
  simulator: { status: "ok" | "error" };
}

/** 서버 상태 위젯 — web/api/mqtt/redis/gateway/scheduler/simulator 7개 항목을 한 번에 조회한다. */
export function getSystemStatus(): Promise<SystemStatus> {
  return authedJson<SystemStatus>("/health/system");
}

// ─── AI 추천 · HITL 승인 (SRS 3.5, M11) ────────────────────────────────

export function createRecommendation(body: CreateRecommendationRequest): Promise<RecommendationRecord> {
  return authedJson<RecommendationRecord>("/api/v1/recommendations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listRecommendations(status?: string): Promise<RecommendationRecord[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return authedJson<RecommendationRecord[]>(`/api/v1/recommendations${qs}`);
}

export function decideRecommendation(
  id: string,
  body: RecommendationDecisionRequest,
): Promise<RecommendationRecord> {
  return authedJson<RecommendationRecord>(`/api/v1/recommendations/${id}/decision`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ─── 카메라/PTZ (M17, 옵션 — api-spec.md §4-cam) ────────────────────────────

export function listCameras(filter?: { areaId?: string; isPtz?: boolean }): Promise<CameraSummary[]> {
  const params = new URLSearchParams();
  if (filter?.areaId) params.set("areaId", filter.areaId);
  if (filter?.isPtz !== undefined) params.set("isPtz", String(filter.isPtz));
  const qs = params.toString();
  return authedJson<CameraSummary[]>(`/api/v1/cameras${qs ? `?${qs}` : ""}`);
}

export function getCamera(id: string): Promise<CameraSummary> {
  return authedJson<CameraSummary>(`/api/v1/cameras/${id}`);
}

export function createCamera(body: CreateCameraRequest): Promise<CameraSummary> {
  return authedJson<CameraSummary>("/api/v1/cameras", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateCamera(id: string, body: UpdateCameraRequest): Promise<CameraSummary> {
  return authedJson<CameraSummary>(`/api/v1/cameras/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function listCameraPresets(cameraId: string): Promise<CameraPresetRecord[]> {
  return authedJson<CameraPresetRecord[]>(`/api/v1/cameras/${cameraId}/presets`);
}

export function createCameraPreset(
  cameraId: string,
  body: CreateCameraPresetRequest,
): Promise<CameraPresetRecord> {
  return authedJson<CameraPresetRecord>(`/api/v1/cameras/${cameraId}/presets`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function addCameraCoverage(cameraId: string, areaId: string): Promise<{ mapped: true }> {
  return authedJson<{ mapped: true }>(`/api/v1/cameras/${cameraId}/coverage/areas/${areaId}`, {
    method: "PUT",
  });
}

export function removeCameraCoverage(cameraId: string, areaId: string): Promise<{ removed: true }> {
  return authedJson<{ removed: true }>(`/api/v1/cameras/${cameraId}/coverage/areas/${areaId}`, {
    method: "DELETE",
  });
}

/** PTZ 이동 — 일반 명령 흐름을 그대로 태운다(commandId 반환, ack는 비동기). */
export function ptzMove(cameraId: string, body: PtzMoveRequest): Promise<CommandCreateResponse> {
  return authedJson<CommandCreateResponse>(`/api/v1/cameras/${cameraId}/ptz`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function ptzGotoPreset(cameraId: string, presetId: string): Promise<CommandCreateResponse> {
  return authedJson<CommandCreateResponse>(`/api/v1/cameras/${cameraId}/presets/${presetId}/goto`, {
    method: "POST",
  });
}

/** 서명된 단기 스트림 URL 발급(§5-cam) — 라이브 뷰(M17 Phase 6)가 이 token을 Authorization
 *  헤더로 실어 hlsUrl/webrtcUrl에 직접 접속한다(이 api 서버를 거치지 않음). */
export function getCameraStream(cameraId: string): Promise<CameraStreamResponse> {
  return authedJson<CameraStreamResponse>(`/api/v1/cameras/${cameraId}/stream`);
}
