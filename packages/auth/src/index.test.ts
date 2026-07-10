import { describe, expect, it } from "vitest";
import { hashPassword, hasAreaAccess, issueJwt, verifyJwt, verifyPassword, type AuthContext } from "./index.js";

const secret = "0123456789abcdef0123456789abcdef";
const context: AuthContext = {
  userId: "11111111-1111-1111-1111-111111111111",
  username: "admin",
  roles: ["ADMIN"],
  topics: ["enterprise/#"],
};

describe("jwt auth", () => {
  it("issues and verifies an HS256 access token", () => {
    const token = issueJwt(context, secret, 60, "access", 1000);

    const verified = verifyJwt(token, secret, "access", 1001);

    expect(verified.userId).toBe(context.userId);
    expect(verified.roles).toEqual(["ADMIN"]);
  });

  it("rejects expired tokens", () => {
    const token = issueJwt(context, secret, 60, "access", 1000);

    expect(() => verifyJwt(token, secret, "access", 1061)).toThrow("jwt expired");
  });

  it("서명 길이가 다른 조작 토큰도 RangeError 없이 invalid signature로 처리", () => {
    const token = issueJwt(context, secret, 60, "access", 1000);
    const [h, p] = token.split(".");
    expect(() => verifyJwt(`${h}.${p}.short`, secret, "access", 1001)).toThrow(
      "invalid jwt signature",
    );
  });
});

describe("password hashing", () => {
  it("verifies pbkdf2 password hashes", () => {
    const hash = hashPassword("admin1234", "fixed-salt");

    expect(verifyPassword("admin1234", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
  });
});

describe("hasAreaAccess", () => {
  const adminCtx: AuthContext = {
    userId: "admin-id",
    username: "admin",
    roles: ["ADMIN"],
    topics: ["enterprise/#"],
  };
  const userCtx: AuthContext = {
    userId: "user-id",
    username: "user",
    roles: ["USER"],
    topics: ["enterprise/site1/bldg-a/2f/living-room/#"],
  };

  it("ADMIN은 모든 area에 접근 가능", () => {
    expect(hasAreaAccess(adminCtx, "enterprise/site1/bldg-a/2f/bedroom")).toBe(true);
  });

  it("허가된 area는 접근 가능", () => {
    expect(hasAreaAccess(userCtx, "enterprise/site1/bldg-a/2f/living-room")).toBe(true);
  });

  it("미허가 area는 접근 불가", () => {
    expect(hasAreaAccess(userCtx, "enterprise/site1/bldg-a/2f/bedroom")).toBe(false);
  });
});
