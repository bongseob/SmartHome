import { describe, expect, it } from "vitest";
import {
  AckPayload,
  CommandPayload,
  LwtPayload,
  OtaUpdateArgs,
  PtzGotoPresetArgs,
  PtzMoveArgs,
  TelemetryPayload,
} from "./payloads.js";

describe("CommandPayload", () => {
  it("필수 필드가 있으면 통과", () => {
    const ok = CommandPayload.safeParse({
      sessionId: "A1001",
      commandId: "CMD-20260709-001",
      command: "turn_on",
      target: "light-01",
      timestamp: 1752045600000,
    });
    expect(ok.success).toBe(true);
  });

  it("필수 필드 누락 시 실패", () => {
    const bad = CommandPayload.safeParse({
      command: "turn_on",
      target: "light-01",
    });
    expect(bad.success).toBe(false);
  });
});

describe("AckPayload", () => {
  it("status는 IN_PROGRESS/SUCCEEDED/FAILED만", () => {
    expect(
      AckPayload.safeParse({
        commandId: "CMD-1",
        status: "SUCCEEDED",
        ts: 1,
        deviceId: "light-01",
      }).success,
    ).toBe(true);
    expect(
      AckPayload.safeParse({
        commandId: "CMD-1",
        status: "CREATED",
        ts: 1,
        deviceId: "light-01",
      }).success,
    ).toBe(false);
  });

  it("FAILED status는 reasonCode를 요구", () => {
    expect(
      AckPayload.safeParse({
        commandId: "CMD-1",
        status: "FAILED",
        reasonCode: 128,
        ts: 1,
        deviceId: "light-01",
      }).success,
    ).toBe(true);
    expect(
      AckPayload.safeParse({
        commandId: "CMD-1",
        status: "FAILED",
        ts: 1,
        deviceId: "light-01",
      }).success,
    ).toBe(false);
  });
});

describe("LwtPayload", () => {
  it("status는 OFFLINE 고정", () => {
    expect(LwtPayload.safeParse({ status: "OFFLINE", ts: 1 }).success).toBe(true);
    expect(LwtPayload.safeParse({ status: "ON", ts: 1 }).success).toBe(false);
  });
});

describe("TelemetryPayload", () => {
  it("다중 지표(number|string) 허용", () => {
    expect(
      TelemetryPayload.safeParse({
        ts: 1,
        metrics: { temperature: 22.5, mode: "cool" },
      }).success,
    ).toBe(true);
  });
});

describe("OtaUpdateArgs", () => {
  it("서명·체크섬·URL을 요구", () => {
    expect(
      OtaUpdateArgs.safeParse({
        version: "1.3.0",
        url: "https://cdn.example/fw.bin",
        sha256: "abc",
        sig: "def",
      }).success,
    ).toBe(true);
    expect(
      OtaUpdateArgs.safeParse({ version: "1.3.0", url: "not-a-url" }).success,
    ).toBe(false);
  });
});

describe("PtzMoveArgs", () => {
  it("pan/tilt/zoom 중 하나만 있어도 통과", () => {
    expect(PtzMoveArgs.safeParse({ pan: 10 }).success).toBe(true);
    expect(PtzMoveArgs.safeParse({ tilt: -5, zoom: 2 }).success).toBe(true);
  });

  it("stop:true 단독으로도 통과", () => {
    expect(PtzMoveArgs.safeParse({ stop: true }).success).toBe(true);
  });

  it("pan/tilt/zoom/stop이 전부 없으면 거부", () => {
    expect(PtzMoveArgs.safeParse({}).success).toBe(false);
  });
});

describe("PtzGotoPresetArgs", () => {
  it("presetId가 있으면 통과, 없으면 거부", () => {
    expect(PtzGotoPresetArgs.safeParse({ presetId: "preset-1" }).success).toBe(true);
    expect(PtzGotoPresetArgs.safeParse({}).success).toBe(false);
  });
});
