import { describe, expect, it } from "vitest";
import { AlarmUpdatedEvent, RealtimeEvent } from "./realtime.js";

describe("AlarmUpdatedEvent", () => {
  it("유효한 이벤트를 통과시킨다", () => {
    const ok = AlarmUpdatedEvent.safeParse({
      type: "alarm.updated",
      alarmId: "1",
      deviceId: "device-1",
      state: "ACK",
      ts: Date.now(),
    });
    expect(ok.success).toBe(true);
  });

  it("잘못된 state는 실패한다", () => {
    const bad = AlarmUpdatedEvent.safeParse({
      type: "alarm.updated",
      alarmId: "1",
      deviceId: null,
      state: "NOT_A_STATE",
      ts: Date.now(),
    });
    expect(bad.success).toBe(false);
  });
});

describe("RealtimeEvent discriminated union", () => {
  it("device.state origin metadata를 허용한다", () => {
    const result = RealtimeEvent.safeParse({
      type: "device.state",
      deviceId: "device-1",
      deviceCode: "light-01",
      status: "ON",
      origin: "INTENTIONAL",
      originLabel: "관리자 제어 (CMD-1)",
      ts: Date.now(),
    });
    expect(result.success).toBe(true);
  });

  it("alarm.updated를 판별해 파싱한다", () => {
    const result = RealtimeEvent.safeParse({
      type: "alarm.updated",
      alarmId: "1",
      deviceId: null,
      state: "RESOLVED",
      ts: Date.now(),
    });
    expect(result.success).toBe(true);
  });
});
