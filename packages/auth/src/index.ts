import type { Role } from "@smarthome/contracts";

/**
 * @smarthome/auth — JWT 발급/검증 + RBAC 가드 (docs/architecture.md §9).
 * TODO: 토큰 발급/검증, Area/Device/Group 권한 가드, MQTT ACL claim(topics) 생성.
 */
export interface AuthContext {
  userId: string;
  roles: Role[];
  /** MQTT ACL 용 허가 토픽 서브트리(§mqtt-topic-design 6.3) */
  topics: string[];
}

export function hasRole(ctx: AuthContext, role: Role): boolean {
  return ctx.roles.includes(role);
}
