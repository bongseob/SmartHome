import { describe, expect, it } from "vitest";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";
import { deleteImage, insertImage, listImages } from "./image-repository.js";

class FakeImageDb implements QueryExecutor {
  constructor(private row: Record<string, unknown> | null = null) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    if (text.includes("INSERT INTO image")) {
      this.row = {
        id: "image-1",
        name: params?.[0],
        image_url: params?.[1],
        width_px: params?.[2],
        height_px: params?.[3],
        uploaded_at: new Date("2026-07-11T00:00:00Z"),
      };
      return { rows: [this.row as unknown as T], rowCount: 1 };
    }
    if (text.includes("DELETE FROM image")) {
      const deleted = this.row;
      this.row = null;
      return { rows: deleted ? [deleted as unknown as T] : [], rowCount: deleted ? 1 : 0 };
    }
    if (text.includes("FROM image")) {
      return { rows: this.row ? [this.row as unknown as T] : [], rowCount: this.row ? 1 : 0 };
    }
    throw new Error(`unexpected query: ${text}`);
  }
}

describe("image repository", () => {
  it("insertImage → listImages 매핑(snake→camel)", async () => {
    const db = new FakeImageDb();
    const created = await insertImage(db, {
      name: "분전반 배경",
      imageUrl: "/uploads/images/abc.png",
      widthPx: 800,
      heightPx: 600,
      uploadedBy: "user-1",
    });
    expect(created.id).toBe("image-1");
    expect(created.imageUrl).toBe("/uploads/images/abc.png");
    expect(created.widthPx).toBe(800);

    const list = await listImages(db);
    expect(list[0]?.name).toBe("분전반 배경");
  });

  it("deleteImage는 삭제된 row(경로 포함)를 반환하고, 다시 부르면 null이다", async () => {
    const db = new FakeImageDb({
      id: "image-1",
      name: "x",
      image_url: "/uploads/images/x.png",
      width_px: null,
      height_px: null,
      uploaded_at: new Date(),
    });
    const removed = await deleteImage(db, "image-1");
    expect(removed?.imageUrl).toBe("/uploads/images/x.png");
    expect(await deleteImage(db, "image-1")).toBeNull();
  });
});
