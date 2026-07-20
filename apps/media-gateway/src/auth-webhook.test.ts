import { describe, expect, it } from "vitest";
import { issueStreamToken } from "@smarthome/auth";
import { decideAuth } from "./auth-webhook.js";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("decideAuth", () => {
  it("AUTH_JWT_SECRET이 없으면 항상 500", () => {
    expect(decideAuth({ action: "read", path: "cam-01" }, undefined)).toBe(500);
  });

  it("read/publish가 아닌 액션(api/metrics 등)은 무조건 허용", () => {
    expect(decideAuth({ action: "api", path: "" }, SECRET)).toBe(204);
    expect(decideAuth({ action: "metrics", path: "" }, SECRET)).toBe(204);
  });

  describe("publish", () => {
    const PUBLISH_CREDS = { username: "media-publisher", password: "pw-12345" };

    it("MEDIAMTX_PUBLISH_USERNAME/PASSWORD 미설정이면 401(무자격 publish 차단)", () => {
      expect(decideAuth({ action: "publish", path: "cam-01" }, SECRET)).toBe(401);
    });

    it("자격증명이 일치하면 204", () => {
      expect(
        decideAuth(
          { action: "publish", path: "cam-01", user: "media-publisher", password: "pw-12345" },
          SECRET,
          undefined,
          PUBLISH_CREDS,
        ),
      ).toBe(204);
    });

    it("비밀번호가 틀리면 401", () => {
      expect(
        decideAuth(
          { action: "publish", path: "cam-01", user: "media-publisher", password: "wrong" },
          SECRET,
          undefined,
          PUBLISH_CREDS,
        ),
      ).toBe(401);
    });

    it("사용자명/비밀번호 자체가 없으면 401(익명 publish 차단)", () => {
      expect(decideAuth({ action: "publish", path: "cam-01" }, SECRET, undefined, PUBLISH_CREDS)).toBe(401);
    });
  });

  it("read인데 토큰이 없으면 401", () => {
    expect(decideAuth({ action: "read", path: "cam-01" }, SECRET)).toBe(401);
  });

  it("유효한 토큰 + 일치하는 path면 204", () => {
    const token = issueStreamToken({ cameraId: "cam-1", path: "cam-01" }, SECRET, 60, 1000);
    expect(decideAuth({ action: "read", path: "cam-01", token }, SECRET, 1001)).toBe(204);
  });

  it("password 필드로 넘어온 토큰도 허용(임의 사용자명 + 토큰=비밀번호 방식)", () => {
    const token = issueStreamToken({ cameraId: "cam-1", path: "cam-01" }, SECRET, 60, 1000);
    expect(decideAuth({ action: "read", path: "cam-01", user: "viewer", password: token }, SECRET, 1001)).toBe(204);
  });

  it("만료된 토큰은 401", () => {
    const token = issueStreamToken({ cameraId: "cam-1", path: "cam-01" }, SECRET, 60, 1000);
    expect(decideAuth({ action: "read", path: "cam-01", token }, SECRET, 1061)).toBe(401);
  });

  it("다른 카메라 path로는 401(토큰 발급 대상과 요청 path 불일치)", () => {
    const token = issueStreamToken({ cameraId: "cam-1", path: "cam-01" }, SECRET, 60, 1000);
    expect(decideAuth({ action: "read", path: "cam-02", token }, SECRET, 1001)).toBe(401);
  });

  it("다른 비밀키로 서명된 토큰은 401", () => {
    const token = issueStreamToken({ cameraId: "cam-1", path: "cam-01" }, "different-secret-different-secret", 60, 1000);
    expect(decideAuth({ action: "read", path: "cam-01", token }, SECRET, 1001)).toBe(401);
  });
});
