import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import type { AccessLevel, Role } from "@smarthome/contracts";

export interface AuthContext {
  userId: string;
  username: string;
  roles: Role[];
  topics: string[];
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}

interface JwtHeader {
  alg: "HS256";
  typ: "JWT";
}

interface JwtPayload extends Record<string, unknown> {
  sub: string;
  username: string;
  roles: Role[];
  topics: string[];
  iat: number;
  exp: number;
  typ: "access" | "refresh";
  /** 같은 초에 발급된 토큰도 유일하도록(동시/연속 로그인 시 refresh_token.token_hash 충돌 방지) */
  jti: string;
}

const ACCESS_LEVEL_ORDER: Record<AccessLevel, number> = {
  VIEW: 1,
  CONTROL: 2,
  MANAGE: 3,
};

export function hasRole(ctx: AuthContext, role: Role): boolean {
  return ctx.roles.includes(role);
}

export function isAdmin(ctx: AuthContext): boolean {
  return hasRole(ctx, "ADMIN");
}

export function hasAccessLevel(actual: AccessLevel, required: AccessLevel): boolean {
  return ACCESS_LEVEL_ORDER[actual] >= ACCESS_LEVEL_ORDER[required];
}

export function actorRole(ctx: AuthContext): Role {
  return ctx.roles.includes("ADMIN") ? "ADMIN" : ctx.roles[0] ?? "USER";
}

/**
 * 사용자가 특정 area에 접근 권한이 있는지 확인한다.
 * ADMIN이거나, topics(ACL wildcard) 중 하나가 해당 area를 포함하면 true.
 *
 * areaTopicParts: "enterprise/site1/bldg-a/2f/living-room" (suffix 없는 5세그먼트)
 */
export function hasAreaAccess(ctx: AuthContext, areaTopicPrefix: string): boolean {
  if (isAdmin(ctx)) return true;
  return ctx.topics.some((topic) => {
    // topic = "enterprise/site1/bldg-a/2f/living-room/#"
    const prefix = topic.replace(/\/#$/, "");
    return areaTopicPrefix === prefix || areaTopicPrefix.startsWith(`${prefix}/`);
  });
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function parseBase64UrlJson<T>(input: string): T {
  return JSON.parse(Buffer.from(input, "base64url").toString("utf8")) as T;
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

function assertSecret(secret: string): void {
  if (secret.length < 32) {
    throw new Error("AUTH_JWT_SECRET must be at least 32 characters");
  }
}

export function issueJwt(
  ctx: AuthContext,
  secret: string,
  expiresInSeconds: number,
  tokenType: "access" | "refresh" = "access",
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  assertSecret(secret);
  const header: JwtHeader = { alg: "HS256", typ: "JWT" };
  const payload: JwtPayload = {
    sub: ctx.userId,
    username: ctx.username,
    roles: ctx.roles,
    topics: ctx.topics,
    iat: nowSeconds,
    exp: nowSeconds + expiresInSeconds,
    typ: tokenType,
    jti: randomBytes(9).toString("base64url"),
  };
  const encoded = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  return `${encoded}.${sign(encoded, secret)}`;
}

export function issueTokenPair(
  ctx: AuthContext,
  secret: string,
  accessTtlSeconds = 900,
  refreshTtlSeconds = 60 * 60 * 24 * 14,
): TokenPair {
  return {
    accessToken: issueJwt(ctx, secret, accessTtlSeconds, "access"),
    refreshToken: issueJwt(ctx, secret, refreshTtlSeconds, "refresh"),
    tokenType: "Bearer",
    expiresIn: accessTtlSeconds,
  };
}

export function verifyJwt(
  token: string,
  secret: string,
  expectedType: "access" | "refresh" = "access",
  nowSeconds = Math.floor(Date.now() / 1000),
): AuthContext {
  assertSecret(secret);
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("invalid jwt format");
  }
  const [encodedHeader, encodedPayload, signature] = parts;
  if (!encodedHeader || !encodedPayload || !signature) {
    throw new Error("invalid jwt format");
  }
  const expectedSignature = sign(`${encodedHeader}.${encodedPayload}`, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  // 길이가 다르면 timingSafeEqual이 throw(RangeError)하므로 먼저 검사한다
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new Error("invalid jwt signature");
  }

  const header = parseBase64UrlJson<JwtHeader>(encodedHeader);
  if (header.alg !== "HS256" || header.typ !== "JWT") {
    throw new Error("unsupported jwt header");
  }

  const payload = parseBase64UrlJson<JwtPayload>(encodedPayload);
  if (payload.typ !== expectedType) {
    throw new Error("unexpected jwt type");
  }
  if (payload.exp <= nowSeconds) {
    throw new Error("jwt expired");
  }

  return {
    userId: payload.sub,
    username: payload.username,
    roles: payload.roles,
    topics: payload.topics,
  };
}

export interface StreamTokenClaims {
  cameraId: string;
  /** MediaMTX 경로(카메라 stream_url의 pathname) — 어댑터가 이 카메라 토큰으로 다른 경로를
   *  재생하지 못하도록 인증 웹훅에서 요청 path와 대조한다. */
  path: string;
}

interface StreamTokenPayload extends Record<string, unknown>, StreamTokenClaims {
  iat: number;
  exp: number;
  typ: "stream";
}

/**
 * 카메라 스트림 단기 서명 토큰(architecture.md §5-cam "서명된 단기 스트림 URL").
 * access/refresh 토큰과 클레임 모양이 아예 달라(로그인 사용자 정보 없음, 카메라·경로만)
 * issueJwt/verifyJwt를 억지로 재사용하지 않고 같은 HS256 서명 방식만 공유한다.
 * media-gateway가 MediaMTX의 authHTTPAddress 웹훅에서 verifyStreamToken으로 검증한다.
 */
export function issueStreamToken(
  claims: StreamTokenClaims,
  secret: string,
  expiresInSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  assertSecret(secret);
  const header: JwtHeader = { alg: "HS256", typ: "JWT" };
  const payload: StreamTokenPayload = {
    cameraId: claims.cameraId,
    path: claims.path,
    iat: nowSeconds,
    exp: nowSeconds + expiresInSeconds,
    typ: "stream",
  };
  const encoded = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifyStreamToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): StreamTokenClaims {
  assertSecret(secret);
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("invalid jwt format");
  }
  const [encodedHeader, encodedPayload, signature] = parts;
  if (!encodedHeader || !encodedPayload || !signature) {
    throw new Error("invalid jwt format");
  }
  const expectedSignature = sign(`${encodedHeader}.${encodedPayload}`, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new Error("invalid jwt signature");
  }

  const header = parseBase64UrlJson<JwtHeader>(encodedHeader);
  if (header.alg !== "HS256" || header.typ !== "JWT") {
    throw new Error("unsupported jwt header");
  }

  const payload = parseBase64UrlJson<StreamTokenPayload>(encodedPayload);
  if (payload.typ !== "stream") {
    throw new Error("unexpected jwt type");
  }
  if (payload.exp <= nowSeconds) {
    throw new Error("jwt expired");
  }

  return { cameraId: payload.cameraId, path: payload.path };
}

export function hashPassword(password: string, salt = randomBytes(16).toString("base64url")): string {
  const iterations = 120000;
  const digest = pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("base64url");
  return `pbkdf2$sha256$${iterations}$${salt}$${digest}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [scheme, algorithm, iterationsText, salt, expected] = storedHash.split("$");
  if (scheme !== "pbkdf2" || algorithm !== "sha256" || !iterationsText || !salt || !expected) {
    return false;
  }
  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations < 10000) {
    return false;
  }
  const actual = pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("base64url");
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
