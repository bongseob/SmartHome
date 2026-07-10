import type {
  AuthUser,
  CommandCreateResponse,
  DeviceHistory,
  DeviceListItem,
  FloorOverview,
  FloorSummary,
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
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
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

export function wsUrl(): string {
  const base = import.meta.env.VITE_WS_BASE ?? API_BASE.replace(/^http/, "ws");
  const token = readStoredAuth()?.tokens.accessToken ?? "";
  return `${base}/ws/realtime?token=${encodeURIComponent(token)}`;
}
