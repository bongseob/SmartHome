import { describe, expect, it } from "vitest";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";
import {
  getActiveRefreshToken,
  getDeviceAccessLevel,
  getUserAuthByUsername,
  revokeRefreshToken,
  storeRefreshToken,
} from "./auth-repository.js";

class FakeAuthDb implements QueryExecutor {
  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    if (text.includes("FROM app_user")) {
      return {
        rows: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            username: "admin",
            email: "admin@example.com",
            password_hash: "hash",
            display_name: "Admin",
            is_active: true,
          } as unknown as T,
        ],
        rowCount: 1,
      };
    }
    if (text.includes("FROM user_role")) {
      return { rows: [{ role: "ADMIN" } as unknown as T], rowCount: 1 };
    }
    if (text.includes("user_device_permission")) {
      return { rows: [{ access_level: "CONTROL" } as unknown as T], rowCount: 1 };
    }
    if (text.includes("user_area_permission")) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes("INSERT INTO refresh_token") || text.includes("UPDATE refresh_token")) {
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("FROM refresh_token")) {
      return {
        rows: [
          {
            token_hash: "hash-1",
            user_id: "11111111-1111-1111-1111-111111111111",
            expires_at: new Date("2026-07-10T00:00:00.000Z"),
            revoked_at: null,
          } as unknown as T,
        ],
        rowCount: 1,
      };
    }
    throw new Error(`unexpected query: ${text}`);
  }
}

describe("auth repository", () => {
  it("builds an auth record with admin MQTT topic claim", async () => {
    const user = await getUserAuthByUsername(new FakeAuthDb(), "admin");

    expect(user?.roles).toEqual(["ADMIN"]);
    expect(user?.topics).toEqual(["enterprise/#"]);
  });

  it("reads direct device access level", async () => {
    const access = await getDeviceAccessLevel(
      new FakeAuthDb(),
      "11111111-1111-1111-1111-111111111111",
      "thermostat-01",
    );

    expect(access).toBe("CONTROL");
  });

  it("stores, reads, and revokes refresh token records", async () => {
    const db = new FakeAuthDb();

    await storeRefreshToken(db, {
      userId: "11111111-1111-1111-1111-111111111111",
      tokenHash: "hash-1",
      expiresAt: new Date("2026-07-10T00:00:00.000Z"),
    });
    const token = await getActiveRefreshToken(db, "hash-1");
    await revokeRefreshToken(db, "hash-1", "hash-2");

    expect(token?.tokenHash).toBe("hash-1");
  });
});
