import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExpiringMap } from "./expiring-map.js";

describe("ExpiringMap(코드 리뷰 P2-2 — 무제한 증가/오래된 음성 캐시 방지)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("TTL 이전에는 값을 반환한다", () => {
    const map = new ExpiringMap<string, string>(1000);
    map.set("a", "1");

    expect(map.get("a")).toBe("1");
    map.stop();
  });

  it("TTL이 지나면 get()이 undefined를 반환한다(지연 만료)", () => {
    const map = new ExpiringMap<string, string>(1000);
    map.set("a", "1");

    vi.advanceTimersByTime(1001);

    expect(map.get("a")).toBeUndefined();
    map.stop();
  });

  it("set()마다 다른 TTL을 줄 수 있다(양성/음성 캐시를 다르게 만료시키는 용도)", () => {
    const map = new ExpiringMap<string, string | null>(10_000);
    map.set("negative", null, 100); // 음성 결과는 짧게
    map.set("positive", "id-1", 10_000); // 양성 결과는 길게

    vi.advanceTimersByTime(101);

    expect(map.get("negative")).toBeUndefined();
    expect(map.get("positive")).toBe("id-1");
    map.stop();
  });

  it("주기적 sweep이 다시 읽히지 않는 만료 항목도 제거한다(메모리 무한 증가 방지)", () => {
    const map = new ExpiringMap<string, string>(1000);
    map.set("a", "1");

    vi.advanceTimersByTime(1500); // sweep 주기(기본 = ttl)를 넘김

    expect(map.get("a")).toBeUndefined();
    map.stop();
  });
});
