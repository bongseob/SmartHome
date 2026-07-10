import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { AuthContext, TokenPair } from "@smarthome/auth";
import { issueTokenPair, verifyJwt, verifyPassword } from "@smarthome/auth";
import type { ActorType } from "@smarthome/contracts";
import {
  getActiveRefreshToken,
  getUserAuthById,
  getUserAuthByUsername,
  insertAuditLog,
  query,
  revokeRefreshToken,
  storeRefreshToken,
} from "@smarthome/db";

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

interface LoginResponse extends TokenPair {
  user: {
    id: string;
    username: string;
    roles: string[];
    topics: string[];
  };
}

const authExecutor = { query };

function jwtSecret(): string {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) {
    throw new Error("AUTH_JWT_SECRET is not configured");
  }
  return secret;
}

function accessTtlSeconds(): number {
  const parsed = Number(process.env.AUTH_ACCESS_TTL_SECONDS ?? "900");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 900;
}

function refreshTtlSeconds(): number {
  const parsed = Number(process.env.AUTH_REFRESH_TTL_SECONDS ?? "1209600");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1209600;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function refreshExpiresAt(): Date {
  return new Date(Date.now() + refreshTtlSeconds() * 1000);
}

function actorTypeFor(roles: string[]): ActorType {
  return roles.includes("ADMIN") ? "ADMIN" : "USER";
}

/** 로그인/refresh/logout은 SRS 4.2.4 감사 대상. target은 계정 자신(self)이다. */
async function auditAuthEvent(
  command: "LOGIN" | "LOGOUT" | "REFRESH",
  executionStatus: "SUCCEEDED" | "FAILED",
  actorType: ActorType,
  actorId: string | null,
  reason: string,
): Promise<void> {
  await insertAuditLog(authExecutor, {
    actorType,
    actorId,
    targetType: "USER",
    targetId: actorId ?? "unknown",
    command,
    reason,
    executionStatus,
    mqttReasonCode: null,
    sessionId: null,
    commandId: null,
  });
}

@Injectable()
export class AuthService {
  async login(body: LoginRequest): Promise<LoginResponse> {
    if (!body.username || !body.password) {
      throw new UnauthorizedException("username and password are required");
    }

    const user = await getUserAuthByUsername(authExecutor, body.username);
    if (!user || !user.isActive || !verifyPassword(body.password, user.passwordHash)) {
      await auditAuthEvent(
        "LOGIN",
        "FAILED",
        "USER",
        null,
        `invalid credentials (username=${body.username})`,
      );
      throw new UnauthorizedException("invalid credentials");
    }

    const tokens = issueTokenPair(
      {
        userId: user.id,
        username: user.username,
        roles: user.roles,
        topics: user.topics,
      },
      jwtSecret(),
      accessTtlSeconds(),
      refreshTtlSeconds(),
    );
    await storeRefreshToken(authExecutor, {
      userId: user.id,
      tokenHash: tokenHash(tokens.refreshToken),
      expiresAt: refreshExpiresAt(),
    });
    await auditAuthEvent(
      "LOGIN",
      "SUCCEEDED",
      actorTypeFor(user.roles),
      user.id,
      `login success (username=${user.username})`,
    );
    return {
      ...tokens,
      user: {
        id: user.id,
        username: user.username,
        roles: user.roles,
        topics: user.topics,
      },
    };
  }

  async refresh(body: RefreshRequest): Promise<LoginResponse> {
    if (!body.refreshToken) {
      throw new UnauthorizedException("refresh token is required");
    }
    let verified: AuthContext;
    try {
      verified = verifyJwt(body.refreshToken, jwtSecret(), "refresh");
    } catch (err) {
      const message = err instanceof Error ? err.message : "invalid refresh token";
      await auditAuthEvent("REFRESH", "FAILED", "USER", null, `refresh failed: ${message}`);
      throw new UnauthorizedException(message);
    }
    const currentHash = tokenHash(body.refreshToken);
    const stored = await getActiveRefreshToken(authExecutor, currentHash);
    if (!stored) {
      await auditAuthEvent(
        "REFRESH",
        "FAILED",
        actorTypeFor(verified.roles),
        verified.userId,
        "refresh failed: token not found, already rotated, or expired",
      );
      throw new UnauthorizedException("invalid refresh token");
    }

    const user = await getUserAuthById(authExecutor, stored.userId);
    if (!user || !user.isActive) {
      await auditAuthEvent(
        "REFRESH",
        "FAILED",
        "USER",
        stored.userId,
        "refresh failed: user inactive or not found",
      );
      throw new UnauthorizedException("invalid refresh token");
    }

    const tokens = issueTokenPair(
      {
        userId: user.id,
        username: user.username,
        roles: user.roles,
        topics: user.topics,
      },
      jwtSecret(),
      accessTtlSeconds(),
      refreshTtlSeconds(),
    );
    const nextHash = tokenHash(tokens.refreshToken);
    await storeRefreshToken(authExecutor, {
      userId: user.id,
      tokenHash: nextHash,
      expiresAt: refreshExpiresAt(),
    });
    await revokeRefreshToken(authExecutor, currentHash, nextHash);
    await auditAuthEvent(
      "REFRESH",
      "SUCCEEDED",
      actorTypeFor(user.roles),
      user.id,
      `refresh success (username=${user.username})`,
    );

    return {
      ...tokens,
      user: {
        id: user.id,
        username: user.username,
        roles: user.roles,
        topics: user.topics,
      },
    };
  }

  async logout(body: RefreshRequest): Promise<{ revoked: true }> {
    if (body.refreshToken) {
      const hash = tokenHash(body.refreshToken);
      const stored = await getActiveRefreshToken(authExecutor, hash);
      await revokeRefreshToken(authExecutor, hash);
      if (stored) {
        const user = await getUserAuthById(authExecutor, stored.userId);
        await auditAuthEvent(
          "LOGOUT",
          "SUCCEEDED",
          user ? actorTypeFor(user.roles) : "USER",
          stored.userId,
          "logout",
        );
      }
    }
    return { revoked: true };
  }
}
