import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { getDeviceAccessLevel, query } from "@smarthome/db";
import { hasAccessLevel, isAdmin } from "@smarthome/auth";
import {
  DEVICE_ACCESS_KEY,
  type DeviceAccessRequirement,
  type RequestWithAuth,
} from "./auth.decorators.js";

const accessExecutor = { query };

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
    if (isAdmin(auth)) {
      return true;
    }

    const deviceId = deviceIdFromRequest(request, requirement);
    if (!deviceId) {
      throw new ForbiddenException("device target is required");
    }
    const access = await getDeviceAccessLevel(accessExecutor, auth.userId, deviceId);
    if (access && hasAccessLevel(access, requirement.level)) {
      return true;
    }
    throw new ForbiddenException("device access denied");
  }
}
