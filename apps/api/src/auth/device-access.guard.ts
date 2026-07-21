import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { getDeviceAccessLevel, query } from "@smarthome/db";
import { hasAccessLevel, isAdmin, type AuthContext } from "@smarthome/auth";
import type { AccessLevel } from "@smarthome/contracts";
import {
  DEVICE_ACCESS_KEY,
  type DeviceAccessRequirement,
  type RequestWithAuth,
} from "./auth.decorators.js";

const accessExecutor = { query };

/**
 * DeviceAccessGuard와 같은 판정 로직을 라우트 데코레이터로 표현할 수 없는 곳(대상 device id를
 * 얻으려면 먼저 다른 레코드를 조회해야 하는 경우 — 예: commandId → command.targetId)에서
 * 서비스가 직접 호출한다(코드 리뷰 P1 #2 — 이런 지점들에 권한 검사가 아예 빠져 있었다).
 */
export async function assertDeviceAccess(
  auth: AuthContext,
  deviceId: string,
  level: AccessLevel,
): Promise<void> {
  if (isAdmin(auth)) return;
  const access = await getDeviceAccessLevel(accessExecutor, auth.userId, deviceId);
  if (access && hasAccessLevel(access, level)) return;
  throw new ForbiddenException("device access denied");
}

function bodyTargetId(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("target" in body)) {
    return null;
  }
  const target = (body as { target?: unknown }).target;
  if (typeof target !== "object" || target === null || !("id" in target)) {
    return null;
  }
  const id = (target as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

function deviceIdFromRequest(request: RequestWithAuth, requirement: DeviceAccessRequirement): string | null {
  if (requirement.source === "routeParam") {
    return request.params?.[requirement.paramName] ?? null;
  }
  return bodyTargetId(request.body);
}

@Injectable()
export class DeviceAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<DeviceAccessRequirement>(
      DEVICE_ACCESS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requirement) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const auth = request.auth;
    if (!auth) {
      throw new ForbiddenException("auth context missing");
    }

    const deviceId = deviceIdFromRequest(request, requirement);
    if (!deviceId) {
      throw new ForbiddenException("device target is required");
    }
    await assertDeviceAccess(auth, deviceId, requirement.level);
    return true;
  }
}
