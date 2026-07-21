import type { AccessLevel, Role } from "@smarthome/contracts";
import { buildAreaAclTopic, buildEnterpriseAclTopic } from "@smarthome/contracts";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";

export interface UserAuthRecord {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  displayName: string | null;
  isActive: boolean;
  roles: Role[];
  topics: string[];
}

export interface RefreshTokenRecord {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface StoreRefreshTokenInput {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

interface UserRow extends QueryResultRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  is_active: boolean;
}

interface RoleRow extends QueryResultRow {
  role: Role;
}

interface AreaTopicRow extends QueryResultRow {
  site_slug: string;
  building_slug: string;
  floor_slug: string;
  area_slug: string;
}

interface AccessRow extends QueryResultRow {
  access_level: AccessLevel;
}

interface RefreshTokenRow extends QueryResultRow {
  token_hash: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

function toUser(row: UserRow, roles: Role[], topics: string[]): UserAuthRecord {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    isActive: row.is_active,
    roles,
    topics,
  };
}

export async function listUserRoles(db: QueryExecutor, userId: string): Promise<Role[]> {
  const result = await db.query<RoleRow>(
    `SELECT role
     FROM user_role
     WHERE user_id::text = $1
     ORDER BY role`,
    [userId],
  );
  return result.rows.map((row) => row.role);
}

export async function listUserTopicClaims(
  db: QueryExecutor,
  userId: string,
  roles: Role[],
): Promise<string[]> {
  if (roles.includes("ADMIN")) {
    return [buildEnterpriseAclTopic()];
  }
  const result = await db.query<AreaTopicRow>(
    `SELECT s.slug AS site_slug, b.slug AS building_slug, f.slug AS floor_slug, a.slug AS area_slug
     FROM user_area_permission uap
     JOIN area a ON a.id = uap.area_id
     JOIN floor f ON f.id = a.floor_id
     JOIN building b ON b.id = f.building_id
     JOIN site s ON s.id = b.site_id
     WHERE uap.user_id::text = $1
     ORDER BY s.slug, b.slug, f.slug, a.slug`,
    [userId],
  );
  return result.rows.map((row) =>
    buildAreaAclTopic({
      site: row.site_slug,
      building: row.building_slug,
      floor: row.floor_slug,
      area: row.area_slug,
    }),
  );
}

export async function getUserAuthByUsername(
  db: QueryExecutor,
  username: string,
): Promise<UserAuthRecord | null> {
  const result = await db.query<UserRow>(
    `SELECT id::text, username, email, password_hash, display_name, is_active
     FROM app_user
     WHERE username = $1
     LIMIT 1`,
    [username],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  const roles = await listUserRoles(db, row.id);
  const topics = await listUserTopicClaims(db, row.id, roles);
  return toUser(row, roles, topics);
}

export async function getUserAuthById(
  db: QueryExecutor,
  userId: string,
): Promise<UserAuthRecord | null> {
  const result = await db.query<UserRow>(
    `SELECT id::text, username, email, password_hash, display_name, is_active
     FROM app_user
     WHERE id::text = $1
     LIMIT 1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  const roles = await listUserRoles(db, row.id);
  const topics = await listUserTopicClaims(db, row.id, roles);
  return toUser(row, roles, topics);
}

export async function getDeviceAccessLevel(
  db: QueryExecutor,
  userId: string,
  deviceIdOrCode: string,
): Promise<AccessLevel | null> {
  const direct = await db.query<AccessRow>(
    `SELECT udp.access_level
     FROM user_device_permission udp
     JOIN device d ON d.id = udp.device_id
     WHERE udp.user_id::text = $1 AND (d.id::text = $2 OR d.code = $2)
     LIMIT 1`,
    [userId, deviceIdOrCode],
  );
  if (direct.rows[0]) {
    return direct.rows[0].access_level;
  }

  const area = await db.query<AccessRow>(
    `SELECT uap.access_level
     FROM user_area_permission uap
     JOIN device d ON d.area_id = uap.area_id
     WHERE uap.user_id::text = $1 AND (d.id::text = $2 OR d.code = $2)
     LIMIT 1`,
    [userId, deviceIdOrCode],
  );
  return area.rows[0]?.access_level ?? null;
}

function toRefreshTokenRecord(row: RefreshTokenRow): RefreshTokenRecord {
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export async function storeRefreshToken(
  db: QueryExecutor,
  input: StoreRefreshTokenInput,
): Promise<void> {
  await db.query(
    `INSERT INTO refresh_token (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [input.userId, input.tokenHash, input.expiresAt],
  );
}

export async function getActiveRefreshToken(
  db: QueryExecutor,
  tokenHash: string,
  now = new Date(),
): Promise<RefreshTokenRecord | null> {
  const result = await db.query<RefreshTokenRow>(
    `SELECT token_hash, user_id::text, expires_at, revoked_at
     FROM refresh_token
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2
     LIMIT 1`,
    [tokenHash, now],
  );
  const row = result.rows[0];
  return row ? toRefreshTokenRecord(row) : null;
}

export async function revokeRefreshToken(
  db: QueryExecutor,
  tokenHash: string,
  replacedByHash: string | null = null,
): Promise<void> {
  await db.query(
    `UPDATE refresh_token
     SET revoked_at = now(), replaced_by_hash = $2
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash, replacedByHash],
  );
}

export interface ClaimedRefreshToken {
  userId: string;
}

/**
 * refresh 회전 전용 — 조회(SELECT)와 폐기(UPDATE)를 분리하지 않고 단일 UPDATE...RETURNING으로
 * 원자적으로 claim한다(코드 리뷰 P1 #1). 동시에 같은 refresh token으로 두 요청이 오면, 먼저 이
 * 행에 도달한 트랜잭션이 커밋될 때까지 두 번째 UPDATE는 Postgres 행 잠금으로 대기하다가
 * 커밋 후 재평가되어 `revoked_at IS NULL` 조건에 걸려 자동으로 0행(실패)이 된다 — 두 트랜잭션
 * 모두 유효한 후손 토큰을 발급하는 경쟁을 원천 차단한다. `withTransaction`으로 감싼 client와
 * 함께 호출해야 한다(단독 query 실행이면 락이 즉시 풀려 원자성 보장이 없다).
 */
export async function claimRefreshToken(
  db: QueryExecutor,
  tokenHash: string,
  now = new Date(),
): Promise<ClaimedRefreshToken | null> {
  const result = await db.query<{ user_id: string }>(
    `UPDATE refresh_token
     SET revoked_at = now()
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2
     RETURNING user_id::text`,
    [tokenHash, now],
  );
  const row = result.rows[0];
  return row ? { userId: row.user_id } : null;
}

/** claimRefreshToken으로 폐기(claim)한 행에 "무엇으로 교체됐는지" 기록만 남긴다(감사용). */
export async function setRefreshTokenReplacement(
  db: QueryExecutor,
  tokenHash: string,
  replacedByHash: string,
): Promise<void> {
  await db.query(
    `UPDATE refresh_token SET replaced_by_hash = $2 WHERE token_hash = $1`,
    [tokenHash, replacedByHash],
  );
}
