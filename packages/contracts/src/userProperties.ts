import type { Role } from "./enums.js";

/**
 * 명령 메타데이터는 payload가 아닌 MQTT5 User Properties 로 싣는다 (SRS 4.3.3).
 * 키 이름 단일 소스.
 */
export const USER_PROPERTY_KEYS = {
  actorId: "Actor_ID",
  sessionId: "Session_ID",
  commandId: "Command_ID",
  role: "Role",
  requestTime: "Request_Time",
} as const;

export interface CommandUserProperties {
  actorId: string;
  sessionId: string;
  commandId: string;
  role: Role;
  requestTimeMs: number;
}

/** mqtt.js 의 properties.userProperties 형태(문자열 맵)로 변환 */
export function toUserProperties(
  props: CommandUserProperties,
): Record<string, string> {
  return {
    [USER_PROPERTY_KEYS.actorId]: props.actorId,
    [USER_PROPERTY_KEYS.sessionId]: props.sessionId,
    [USER_PROPERTY_KEYS.commandId]: props.commandId,
    [USER_PROPERTY_KEYS.role]: props.role,
    [USER_PROPERTY_KEYS.requestTime]: String(props.requestTimeMs),
  };
}

/** User Properties 맵에서 명령 메타데이터 복원(수신측). 누락 시 null */
export function fromUserProperties(
  raw: Record<string, string | string[]> | undefined,
): CommandUserProperties | null {
  if (!raw) return null;
  const get = (k: string): string | undefined => {
    const v = raw[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const actorId = get(USER_PROPERTY_KEYS.actorId);
  const sessionId = get(USER_PROPERTY_KEYS.sessionId);
  const commandId = get(USER_PROPERTY_KEYS.commandId);
  const role = get(USER_PROPERTY_KEYS.role);
  const requestTime = get(USER_PROPERTY_KEYS.requestTime);
  if (!actorId || !sessionId || !commandId || !role || !requestTime) {
    return null;
  }
  return {
    actorId,
    sessionId,
    commandId,
    role: role as Role,
    requestTimeMs: Number(requestTime),
  };
}
