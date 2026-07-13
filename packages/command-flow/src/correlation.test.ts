import { describe, expect, it } from "vitest";
import {
  clearCorrelation,
  commandKey,
  dueCommandIds,
  getCorrelation,
  storeNewCorrelation,
  updateCorrelationStatus,
  type CommandCorrelationState,
  type RedisCommandClient,
} from "./correlation.js";

class FakeRedis implements RedisCommandClient {
  private readonly kv = new Map<string, string>();
  private readonly zsets = new Map<string, Map<string, number>>();
  readonly isReady = true;

  async connect(): Promise<unknown> {
    return undefined;
  }

  async quit(): Promise<unknown> {
    return undefined;
  }

  on(): unknown {
    return undefined;
  }

  async get(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    options?: { PX?: number; NX?: boolean; XX?: boolean },
  ): Promise<string | null> {
    const exists = this.kv.has(key);
    if (options?.NX && exists) return null;
    if (options?.XX && !exists) return null;
    this.kv.set(key, value);
    return "OK";
  }

  async del(key: string): Promise<number> {
    return this.kv.delete(key) ? 1 : 0;
  }

  async zAdd(key: string, item: { score: number; value: string }): Promise<number> {
    const zset = this.zsets.get(key) ?? new Map<string, number>();
    const existed = zset.has(item.value);
    zset.set(item.value, item.score);
    this.zsets.set(key, zset);
    return existed ? 0 : 1;
  }

  async zRem(key: string, member: string): Promise<number> {
    return this.zsets.get(key)?.delete(member) ? 1 : 0;
  }

  async zRangeByScore(key: string, min: number, max: number): Promise<string[]> {
    return [...(this.zsets.get(key)?.entries() ?? [])]
      .filter(([, score]) => score >= min && score <= max)
      .map(([member]) => member);
  }
}

function state(overrides: Partial<CommandCorrelationState> = {}): CommandCorrelationState {
  return {
    commandId: "CMD-1",
    deviceCode: "light-01",
    sessionId: "S-1",
    status: "PENDING",
    deadlineEpochMs: 1000,
    ...overrides,
  };
}

describe("command correlation", () => {
  it("새 correlation은 NX로 저장하고 due set에 등록한다", async () => {
    const redis = new FakeRedis();

    await expect(storeNewCorrelation(redis, state(), 30000)).resolves.toBe(true);
    await expect(storeNewCorrelation(redis, state(), 30000)).resolves.toBe(false);

    expect(await getCorrelation(redis, "CMD-1")).toMatchObject({
      commandId: "CMD-1",
      status: "PENDING",
    });
    expect(await dueCommandIds(redis, 1000)).toEqual(["CMD-1"]);
  });

  it("기존 correlation은 XX로 상태를 갱신한다", async () => {
    const redis = new FakeRedis();
    await storeNewCorrelation(redis, state(), 30000);

    await expect(
      updateCorrelationStatus(redis, state({ status: "IN_PROGRESS" }), 30000),
    ).resolves.toBe(true);

    expect(await getCorrelation(redis, "CMD-1")).toMatchObject({ status: "IN_PROGRESS" });
  });

  it("clearCorrelation은 key와 timeout entry를 함께 삭제한다", async () => {
    const redis = new FakeRedis();
    await storeNewCorrelation(redis, state(), 30000);

    await clearCorrelation(redis, "CMD-1");

    expect(await redis.get(commandKey("CMD-1"))).toBeNull();
    expect(await dueCommandIds(redis, 1000)).toEqual([]);
  });
});
