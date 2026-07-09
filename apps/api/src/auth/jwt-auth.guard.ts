import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { verifyJwt } from "@smarthome/auth";
import { IS_PUBLIC_KEY, type RequestWithAuth } from "./auth.decorators.js";

function jwtSecret(): string {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) {
    throw new Error("AUTH_JWT_SECRET is not configured");
  }
  return secret;
}

function bearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    return null;
  }
  const [scheme, token] = value.split(" ");
  return scheme === "Bearer" && token ? token : null;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const token = bearerToken(request.headers?.authorization);
    if (!token) {
      throw new UnauthorizedException("bearer token required");
    }

    try {
      request.auth = verifyJwt(token, jwtSecret(), "access");
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "invalid token";
      throw new UnauthorizedException(message);
    }
  }
}
