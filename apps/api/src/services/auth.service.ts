import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { issueTokenPair, verifyJwt, verifyPassword, type TokenPair } from "@smarthome/auth";
import {
  getActiveRefreshToken,
  getUserAuthById,
  getUserAuthByUsername,
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

@Injectable()
export class AuthService {
  async login(body: LoginRequest): Promise<LoginResponse> {
    if (!body.username || !body.password) {
      throw new UnauthorizedException("username and password are required");
    }

    const user = await getUserAuthByUsername(authExecutor, body.username);
    if (!user || !user.isActive || !verifyPassword(body.password, user.passwordHash)) {
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
    try {
      verifyJwt(body.refreshToken, jwtSecret(), "refresh");
    } catch (err) {
      const message = err instanceof Error ? err.message : "invalid refresh token";
      throw new UnauthorizedException(message);
    }
    const currentHash = tokenHash(body.refreshToken);
    const stored = await getActiveRefreshToken(authExecutor, currentHash);
    if (!stored) {
      throw new UnauthorizedException("invalid refresh token");
    }

    const user = await getUserAuthById(authExecutor, stored.userId);
    if (!user || !user.isActive) {
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
      await revokeRefreshToken(authExecutor, tokenHash(body.refreshToken));
    }
    return { revoked: true };
  }
}
