import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";

// ─── Image library (docs/srs-lighting-control-addendum.md §2.1) ───────────
// 재사용 이미지 라이브러리(레거시 이미지관리). floor/area(분전반)가 image_id로 참조한다.
// 파일 자체는 로컬 파일시스템에 저장(부록 A.1), DB에는 경로(image_url)만 보관.

export interface ImageRecord {
  id: string;
  name: string;
  /** 이 이미지가 어떤 용도로 쓰이는지 관리자가 남기는 부연 설명. area 배경 외에 다른 것의
   *  배경으로도 재사용될 수 있어(2026-07-15), 용도 파악을 돕는 자유 텍스트다. */
  description: string | null;
  imageUrl: string;
  widthPx: number | null;
  heightPx: number | null;
  uploadedAt: Date;
}

interface ImageRow extends QueryResultRow {
  id: string;
  name: string;
  description: string | null;
  image_url: string;
  width_px: number | null;
  height_px: number | null;
  uploaded_at: Date;
}

function toImage(row: ImageRow): ImageRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    widthPx: row.width_px,
    heightPx: row.height_px,
    uploadedAt: row.uploaded_at,
  };
}

const IMAGE_COLUMNS = `id::text, name, description, image_url, width_px, height_px, uploaded_at`;

export interface InsertImageInput {
  name: string;
  description?: string | null;
  imageUrl: string;
  widthPx: number | null;
  heightPx: number | null;
  uploadedBy: string | null;
}

export async function insertImage(
  db: QueryExecutor,
  input: InsertImageInput,
): Promise<ImageRecord> {
  const r = await db.query<ImageRow>(
    `INSERT INTO image (name, description, image_url, width_px, height_px, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING ${IMAGE_COLUMNS}`,
    [input.name, input.description ?? null, input.imageUrl, input.widthPx, input.heightPx, input.uploadedBy],
  );
  const row = r.rows[0];
  if (!row) throw new Error("image insert did not return a row");
  return toImage(row);
}

export async function listImages(db: QueryExecutor): Promise<ImageRecord[]> {
  const r = await db.query<ImageRow>(
    `SELECT ${IMAGE_COLUMNS} FROM image ORDER BY uploaded_at DESC`,
  );
  return r.rows.map(toImage);
}

export async function getImageById(db: QueryExecutor, id: string): Promise<ImageRecord | null> {
  const r = await db.query<ImageRow>(
    `SELECT ${IMAGE_COLUMNS} FROM image WHERE id::text = $1`,
    [id],
  );
  const row = r.rows[0];
  return row ? toImage(row) : null;
}

export interface UpdateImageInput {
  name?: string;
  description?: string | null;
  imageUrl?: string;
  widthPx?: number | null;
  heightPx?: number | null;
}

/** 이름/설명 수정 또는 파일 교체(같은 id 유지 — image_id를 참조하는 다른 엔티티는 그대로 최신
 *  파일을 보게 된다). 미지정 필드는 부분 업데이트로 건너뛴다. */
export async function updateImage(
  db: QueryExecutor,
  id: string,
  input: UpdateImageInput,
): Promise<ImageRecord | null> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  if (input.name !== undefined) {
    params.push(input.name);
    sets.push(`name = $${params.length}`);
  }
  if (input.description !== undefined) {
    params.push(input.description);
    sets.push(`description = $${params.length}`);
  }
  if (input.imageUrl !== undefined) {
    params.push(input.imageUrl);
    sets.push(`image_url = $${params.length}`);
  }
  if (input.widthPx !== undefined) {
    params.push(input.widthPx);
    sets.push(`width_px = $${params.length}`);
  }
  if (input.heightPx !== undefined) {
    params.push(input.heightPx);
    sets.push(`height_px = $${params.length}`);
  }
  if (sets.length === 0) return getImageById(db, id);

  const r = await db.query<ImageRow>(
    `UPDATE image SET ${sets.join(", ")} WHERE id::text = $1 RETURNING ${IMAGE_COLUMNS}`,
    params,
  );
  const row = r.rows[0];
  return row ? toImage(row) : null;
}

/** 삭제된 image row를 반환(파일 경로 unlink에 사용). 없으면 null. area.image_id는 ON DELETE SET NULL. */
export async function deleteImage(db: QueryExecutor, id: string): Promise<ImageRecord | null> {
  const r = await db.query<ImageRow>(
    `DELETE FROM image WHERE id::text = $1 RETURNING ${IMAGE_COLUMNS}`,
    [id],
  );
  const row = r.rows[0];
  return row ? toImage(row) : null;
}
