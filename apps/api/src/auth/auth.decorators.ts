import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { AccessLevel, Role } from "@smarthome/contracts";
import type { AuthContext } from "@smarthome/auth";

export const IS_PUBLIC_KEY = "smarthome:isPublic";
export const ROLES_KEY = "smarthome:roles";
export const DEVICE_ACCESS_KEY = "smarthome:deviceAccess";

export interface RequestWithAuth {
  headers?: Record<string, string | string[] | undefined>;
  params?: Record<string, string | undefined>;
  body?: unknown;
  url?: string;
  auth?: AuthContext;
}

export interface DeviceAccessRequirement {
  level: AccessLevel;
  source: "routeParam" | "bodyTarget";
  paramName: string;
}

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

export const RequireDeviceAccess = (
  level: AccessLevel,
  source: "routeParam" | "bodyTarget",
  paramName = "id",
): MethodDecorator & ClassDecorator =>
  SetMetadata(DEVICE_ACCESS_KEY, { level, source, paramName } satisfies DeviceAccessRequirement);

export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<RequestWithAuth>();
  if (!request.auth) {
    throw new Error("auth context missing");
  }
  return request.auth;
});
