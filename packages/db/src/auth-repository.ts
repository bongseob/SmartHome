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
