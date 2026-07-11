import { describe, expect, it } from "vitest";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";
import {
  DEFAULT_SEQUENTIAL_INTERVAL_MS,
  getSequentialIntervalMs,
} from "./system-setting-repository.js";

class FakeSettingDb implements QueryExecutor {
  constructor(private value: unknown) {}
  async query<T extends QueryResultRow = QueryResultRow>(): Promise<{ rows: T[]; rowCount: number | null }> {
    if (this.value === undefined) return { rows: [], rowCount: 0 };
    return { rows: [{ value: this.value } as unknown as T], rowCount: 1 };
  }
}

describe("system setting repository", () => {
  it("설정된 숫자값을 그대로 반환한다", async () => {
    expect(await getSequentialIntervalMs(new FakeSettingDb(1500))).toBe(1500);
    expect(await getSequentialIntervalMs(new FakeSettingDb(3000))).toBe(3000);
  });

  it("설정이 없으면 기본 1500ms", async () => {
    expect(await getSequentialIntervalMs(new FakeSettingDb(undefined))).toBe(
      DEFAULT_SEQUENTIAL_INTERVAL_MS,
    );
  });

  it("숫자가 아니거나 음수면 기본값으로 폴백", async () => {
    expect(await getSequentialIntervalMs(new FakeSettingDb("nope"))).toBe(1500);
    expect(await getSequentialIntervalMs(new FakeSettingDb(-5))).toBe(1500);
  });
});
