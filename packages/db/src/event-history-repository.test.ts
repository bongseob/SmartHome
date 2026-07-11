import { describe, expect, it } from "vitest";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";
import { listEventHistory } from "./event-history-repository.js";

class CapturingDb implements QueryExecutor {
  lastParams: unknown[] | undefined;
  async query<T extends QueryResultRow = QueryResultRow>(
    _text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    this.lastParams = params;
    return {
      rows: [
        {
          source: "AUDIT",
          grade: "INFO",
          time: new Date("2026-07-11T10:00:00Z"),
          target_type: "DEVICE",
          target_id: "device-1",
          label: "turn_off",
          detail: "제어",
          status: "SUCCEEDED",
        } as unknown as T,
      ],
      rowCount: 1,
    };
  }
}

describe("event history repository", () => {
  it("등급/기간 플래그를 순서대로 파라미터 바인딩한다", async () => {
    const db = new CapturingDb();
    const from = new Date("2026-07-01T00:00:00Z");
    const to = new Date("2026-07-31T23:59:59Z");
    await listEventHistory(db, { from, to, includeInfo: true, includeWarning: false, limit: 50 });
    // [from, to, includeInfo, includeWarning, limit]
    expect(db.lastParams).toEqual([from, to, true, false, 50]);
  });

  it("row를 camelCase 레코드로 매핑한다", async () => {
    const db = new CapturingDb();
    const rows = await listEventHistory(db, { includeInfo: true, includeWarning: true });
    expect(rows[0]).toMatchObject({
      source: "AUDIT",
      grade: "INFO",
      targetType: "DEVICE",
      targetId: "device-1",
      label: "turn_off",
    });
  });

  it("from/to 미지정 시 null, limit 기본 200", async () => {
    const db = new CapturingDb();
    await listEventHistory(db, { includeInfo: true, includeWarning: true });
    expect(db.lastParams).toEqual([null, null, true, true, 200]);
  });
});
