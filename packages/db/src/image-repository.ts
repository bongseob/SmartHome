import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";

// ─── Image library (docs/srs-lighting-control-addendum.md §2.1) ───────────
// 재사용 이미지 라이브러리(레거시 이미지관리). floor/area(분전반)가 image_id로 참조한다.
// 파일 자체는 로컬 파일시스템에 저장(부록 A.1), DB에는 경로(image_url)만 보관.

export interface ImageRecord {
  id: string;
  name: string;
  imageUrl: string;
  widthPx: number | null;
  heightPx: number | null;
  uploadedAt: Date;
}

interface ImageRow extends QueryResultRow {
  id: string;
  name: string;
  image_url: string;
  width_px: number | null;
  height_px: number | null;
  uploaded_at: Date;
}

function toImage(row: ImageRow): ImageRecord {
  return {
    id: row.id,
    name: row.name,
    imageUrl: row.image_url,
    widthPx: row.width_px,
    heightPx: row.height_px,
    uploadedAt: row.uploaded_at,
  };
}

const IMAGE_COLUMNS = `id::text, name, image_url, width_px, height_px, uploaded_at`;

export interface InsertImageInput {
  name: string;
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
    `INSERT INTO image (name, image_url, width_px, height_px, uploaded_by)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING ${IMAGE_COLUMNS}`,
    [input.name, input.imageUrl, input.widthPx, input.heightPx, input.uploadedBy],
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

/** 삭제된 image row를 반환(파일 경로 unlink에 사용). 없으면 null. area.image_id는 ON DELETE SET NULL. */
export async function deleteImage(db: QueryExecutor, id: string): Promise<ImageRecord | null> {
  const r = await db.query<ImageRow>(
    `DELETE FROM image WHERE id::text = $1 RETURNING ${IMAGE_COLUMNS}`,
    [id],
  );
  const row = r.rows[0];
  return row ? toImage(row) : null;
}
