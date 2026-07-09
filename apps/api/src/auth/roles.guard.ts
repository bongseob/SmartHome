import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@smarthome/contracts";
import { isAdmin } from "@smarthome/auth";
import { ROLES_KEY, type RequestWithAuth } from "./auth.decorators.js";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const auth = request.auth;
    if (!auth) {
      throw new ForbiddenException("auth context missing");
    }
    if (isAdmin(auth) || required.some((role) => auth.roles.includes(role))) {
      return true;
    }
    throw new ForbiddenException("required role missing");
  }
}
