import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 도면 이미지 로컬 파일시스템 저장 경로(M16, PROJECT_RULES 부록 A.1 — S3 등 오브젝트 스토리지 아님).
 * 이 파일(dist/config/uploads.js) 기준 두 단계 위가 apps/api/ 이다.
 */
export const UPLOADS_ROOT = fileURLToPath(new URL("../../uploads", import.meta.url));
export const FLOOR_MAPS_DIR = join(UPLOADS_ROOT, "floor-maps");
/** 재사용 이미지 라이브러리 저장 경로(addendum §2.1, 부록 A.1 로컬 파일시스템). */
export const IMAGES_DIR = join(UPLOADS_ROOT, "images");

export function ensureFloorMapsDir(): string {
  mkdirSync(FLOOR_MAPS_DIR, { recursive: true });
  return FLOOR_MAPS_DIR;
}

export function ensureImagesDir(): string {
  mkdirSync(IMAGES_DIR, { recursive: true });
  return IMAGES_DIR;
}
