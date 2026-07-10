import type {
  Area,
  AuthUser,
  BuildingRecord,
  CommandCreateResponse,
  CreateSchedulerRequest,
  DeviceHistory,
  DeviceListItem,
  FloorOverview,
  FloorSummary,
  ScheduleRunRecord,
  SchedulerRecord,
  SiteRecord,
  TokenPair,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";

const STORAGE_KEY = "smarthome.auth";

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
  const current = readStoredAuth();
  if (!current) throw new AuthExpiredError();

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

export function listFloors(): Promise<FloorSummary[]> {
  return authedJson<FloorSummary[]>("/api/v1/spatial/floors");
}

export function getFloorOverview(floorId: string): Promise<FloorOverview> {
  return authedJson<FloorOverview>(`/api/v1/spatial/floors/${floorId}/overview`);
}

export interface LayoutPosition {
  deviceId: string;
  posX: number;
  posY: number;
}

/** 도면 편집 모드 — 변경된 기기 좌표 일괄 저장(ADMIN 전용, 서버에서 DEVICE_RELOCATE 감사). */
export function saveFloorLayout(floorId: string, positions: LayoutPosition[]): Promise<unknown> {
  return authedJson(`/api/v1/spatial/floors/${floorId}/layout`, {
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

export function createCommand(
  command: string,
  targetDeviceId: string,
): Promise<CommandCreateResponse> {
  return authedJson<CommandCreateResponse>("/api/v1/commands", {
    method: "POST",
    body: JSON.stringify({ command, target: { id: targetDeviceId } }),
  });
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

// ─── 도면(Floor Map) 관리 (M16 Admin — ADMIN 전용, 로컬 파일시스템 저장) ──

export function uploadFloorMap(
  floorId: string,
  file: File,
  meta: { widthPx: number; heightPx: number; scaleMPerPx: number },
): Promise<FloorSummary> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("widthPx", String(meta.widthPx));
  formData.append("heightPx", String(meta.heightPx));
  formData.append("scaleMPerPx", String(meta.scaleMPerPx));
  return authedFetch(`/api/v1/spatial/floors/${floorId}/floor-map`, {
    method: "POST",
    body: formData,
  }).then(async (response) => {
    if (!response.ok) throw new ApiError(response.status, await parseProblemDetail(response));
    return (await response.json()) as FloorSummary;
  });
}

export function updateFloorMapScale(floorMapId: string, scaleMPerPx: number): Promise<unknown> {
  return authedJson(`/api/v1/spatial/floor-maps/${floorMapId}`, {
    method: "PATCH",
    body: JSON.stringify({ scaleMPerPx }),
  });
}

// ─── 지역(Area) 관리 (M16 Admin — ADMIN 전용) ────────────────────────

export function createArea(
  floorId: string,
  body: { name: string; polygon: number[][]; slug?: string },
): Promise<Area> {
  return authedJson<Area>(`/api/v1/spatial/floors/${floorId}/areas`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateArea(
  areaId: string,
  body: { name?: string; polygon?: number[][] },
): Promise<Area> {
  return authedJson<Area>(`/api/v1/spatial/areas/${areaId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteArea(areaId: string): Promise<{ deleted: true }> {
  return authedJson<{ deleted: true }>(`/api/v1/spatial/areas/${areaId}`, { method: "DELETE" });
}

export function wsUrl(): string {
  const base = import.meta.env.VITE_WS_BASE ?? API_BASE.replace(/^http/, "ws");
  const token = readStoredAuth()?.tokens.accessToken ?? "";
  return `${base}/ws/realtime?token=${encodeURIComponent(token)}`;
}
