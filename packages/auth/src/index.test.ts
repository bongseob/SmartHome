import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  hasAreaAccess,
  issueJwt,
  issueStreamToken,
  verifyJwt,
  verifyPassword,
  verifyStreamToken,
  type AuthContext,
} from "./index.js";

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

describe("camera stream token(§5-cam)", () => {
  it("issues and verifies a stream token", () => {
    const token = issueStreamToken({ cameraId: "cam-1", path: "cam-01" }, secret, 60, 1000);

    const claims = verifyStreamToken(token, secret, 1001);

    expect(claims).toEqual({ cameraId: "cam-1", path: "cam-01" });
  });

  it("rejects expired stream tokens", () => {
    const token = issueStreamToken({ cameraId: "cam-1", path: "cam-01" }, secret, 60, 1000);

    expect(() => verifyStreamToken(token, secret, 1061)).toThrow("jwt expired");
  });

  it("rejects tampered signatures", () => {
    const token = issueStreamToken({ cameraId: "cam-1", path: "cam-01" }, secret, 60, 1000);
    const [h, p] = token.split(".");
    expect(() => verifyStreamToken(`${h}.${p}.short`, secret, 1001)).toThrow("invalid jwt signature");
  });

  it("access 토큰을 stream 토큰으로 검증하면 거부된다(클레임 모양이 달라 typ가 안 맞음)", () => {
    const accessToken = issueJwt(context, secret, 60, "access", 1000);
    expect(() => verifyStreamToken(accessToken, secret, 1001)).toThrow("unexpected jwt type");
  });
});

describe("password hashing", () => {
  it("verifies pbkdf2 password hashes", () => {
    const hash = hashPassword("admin1234", "fixed-salt");

    expect(verifyPassword("admin1234", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
  });
});

describe("encryptSecret/decryptSecret(코드 리뷰 P2 #17 — ONVIF 자격증명 at-rest 암호화)", () => {
  const key = "test-camera-credential-key-32chars-min";

  it("암호화한 값을 같은 키로 복호화하면 원문이 나온다", () => {
    const encrypted = encryptSecret("super-secret-onvif-password", key);
    expect(encrypted).not.toContain("super-secret-onvif-password");
    expect(decryptSecret(encrypted, key)).toBe("super-secret-onvif-password");
  });

  it("같은 평문도 매번 다른 IV로 암호화해 다른 암호문이 나온다(재사용 공격 방지)", () => {
    const a = encryptSecret("same-password", key);
    const b = encryptSecret("same-password", key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe("same-password");
    expect(decryptSecret(b, key)).toBe("same-password");
  });

  it("다른 키로 복호화하면 실패한다(GCM 인증 태그 불일치)", () => {
    const encrypted = encryptSecret("secret", key);
    expect(() => decryptSecret(encrypted, "a-completely-different-key-32chars!")).toThrow();
  });

  it("형식이 잘못된 입력은 명확히 실패한다", () => {
    expect(() => decryptSecret("not-encrypted-plaintext", key)).toThrow("invalid encrypted secret format");
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
