import { describe, expect, it } from "vitest";
import { hashPassword, issueJwt, verifyJwt, verifyPassword, type AuthContext } from "./index.js";

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
});

describe("password hashing", () => {
  it("verifies pbkdf2 password hashes", () => {
    const hash = hashPassword("admin1234", "fixed-salt");

    expect(verifyPassword("admin1234", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
  });
});
