import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchNotification } from "./index.js";

describe("dispatchNotification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("WEBHOOK 채널은 실제 HTTP POST로 발송하고 성공을 반환한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await dispatchNotification(
      { type: "WEBHOOK", name: "ops-webhook", config: { url: "https://example.test/hook" } },
      { alarmId: "1", tier: "REACTIVE", severity: "CRITICAL", message: "가스 누출", deviceId: "d1", escalationLevel: 0, ts: Date.now() },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/hook");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body as string)).toMatchObject({ channel: "ops-webhook", alarmId: "1" });
    expect(result).toEqual({ success: true, attempts: 1 });
  });

  it("url 설정이 없으면 재시도 없이 즉시 실패를 반환한다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await dispatchNotification(
      { type: "WEBHOOK", name: "broken", config: {} },
      { alarmId: "1", tier: "REACTIVE", severity: "CRITICAL", message: null, deviceId: null, escalationLevel: 0, ts: Date.now() },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
  });

  it("첫 시도가 실패해도 재시도해서 성공하면 success:true를 반환한다", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await dispatchNotification(
      { type: "WEBHOOK", name: "flaky", config: { url: "https://example.test/hook" } },
      { alarmId: "1", tier: "REACTIVE", severity: "WARNING", message: null, deviceId: null, escalationLevel: 0, ts: Date.now() },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ success: true, attempts: 2 });
  });

  it("재시도까지 모두 실패하면 throw하지 않고 success:false를 반환한다(알람 처리 흐름을 막지 않음)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await dispatchNotification(
      { type: "WEBHOOK", name: "flaky", config: { url: "https://example.test/hook" } },
      { alarmId: "1", tier: "REACTIVE", severity: "WARNING", message: null, deviceId: null, escalationLevel: 0, ts: Date.now() },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(false);
    expect(result.error).toBe("network down");
  });

  it("PUSH/EMAIL/SMS는 실제 발송 없이 로그 스텁만 남기고 성공을 반환한다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await dispatchNotification(
      { type: "EMAIL", name: "ops-email", config: { to: "ops@example.test" } },
      { alarmId: "1", tier: "PROACTIVE", severity: "WARNING", message: null, deviceId: null, escalationLevel: 1, ts: Date.now() },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
    expect(result).toEqual({ success: true, attempts: 1 });
  });
});
