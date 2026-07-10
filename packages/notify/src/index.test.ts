import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchNotification } from "./index.js";

describe("dispatchNotification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("WEBHOOK 채널은 실제 HTTP POST로 발송한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await dispatchNotification(
      { type: "WEBHOOK", name: "ops-webhook", config: { url: "https://example.test/hook" } },
      { alarmId: "1", tier: "REACTIVE", severity: "CRITICAL", message: "가스 누출", deviceId: "d1", escalationLevel: 0, ts: Date.now() },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/hook");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body as string)).toMatchObject({ channel: "ops-webhook", alarmId: "1" });
  });

  it("url 설정이 없으면 발송을 건너뛴다(에러 없이)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await dispatchNotification(
      { type: "WEBHOOK", name: "broken", config: {} },
      { alarmId: "1", tier: "REACTIVE", severity: "CRITICAL", message: null, deviceId: null, escalationLevel: 0, ts: Date.now() },
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetch가 실패해도 throw하지 않는다(알람 처리 흐름을 막지 않음)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      dispatchNotification(
        { type: "WEBHOOK", name: "flaky", config: { url: "https://example.test/hook" } },
        { alarmId: "1", tier: "REACTIVE", severity: "WARNING", message: null, deviceId: null, escalationLevel: 0, ts: Date.now() },
      ),
    ).resolves.toBeUndefined();
  });

  it("PUSH/EMAIL/SMS는 실제 발송 없이 로그 스텁만 남긴다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await dispatchNotification(
      { type: "EMAIL", name: "ops-email", config: { to: "ops@example.test" } },
      { alarmId: "1", tier: "PROACTIVE", severity: "WARNING", message: null, deviceId: null, escalationLevel: 1, ts: Date.now() },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });
});
