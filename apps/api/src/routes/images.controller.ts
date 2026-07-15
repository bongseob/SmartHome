import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { randomUUID } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { extname, basename } from "node:path";
import type { AuthContext } from "@smarthome/auth";
import { CurrentAuth, Roles } from "../auth/auth.decorators.js";
import { ImagesService } from "../services/images.service.js";
import { ensureImagesDir, IMAGES_DIR } from "../config/uploads.js";
import { join } from "node:path";

const ALLOWED_IMAGE_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

/** 업로드 파일 내용이 확장자와 실제로 일치하는지 매직 넘버로 확인(스푸핑 방지). */
async function hasValidImageSignature(path: string, extension: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (extension === ".png") {
      return bytesRead >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (extension === ".jpg" || extension === ".jpeg") {
      return bytesRead >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    }
    if (extension === ".webp") {
      return bytesRead >= 12 && header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP";
    }
    return false;
  } finally {
    await handle.close();
  }
}

const imageStorage = diskStorage({
  destination: (_req, _file, cb) => cb(null, ensureImagesDir()),
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
});

/** addendum §2.1 · PROJECT_RULES §6 — 이미지 라이브러리는 ADMIN 전용. 파일은 로컬 FS(부록 A.1). */
@Controller("api/v1/images")
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  @Roles("ADMIN")
  @Get()
  list(): Promise<unknown> {
    return this.images.list();
  }

  @Roles("ADMIN")
  @Post()
  @UseInterceptors(
    FileInterceptor("file", {
      storage: imageStorage,
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const extension = extname(file.originalname).toLowerCase();
        cb(null, ALLOWED_IMAGE_TYPES.get(extension) === file.mimetype);
      },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { name: string; description?: string; widthPx?: string; heightPx?: string },
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    if (!file) {
      throw new BadRequestException("file is required (png/jpg/jpeg/webp only)");
    }
    const extension = extname(file.originalname).toLowerCase();
    try {
      if (!(await hasValidImageSignature(file.path, extension))) {
        throw new BadRequestException("uploaded file content does not match its image extension");
      }
      return await this.images.create(
        {
          name: body.name,
          description: body.description ?? null,
          imageUrl: `/uploads/images/${file.filename}`,
          widthPx: body.widthPx !== undefined ? Number(body.widthPx) : null,
          heightPx: body.heightPx !== undefined ? Number(body.heightPx) : null,
        },
        auth,
      );
    } catch (error) {
      await unlink(file.path).catch(() => undefined);
      throw error;
    }
  }

  /**
   * 이름 수정 및/또는 파일 교체 — id(키)는 유지한다. 파일을 새로 보내면 같은 image_id를
   * 참조하는 area 등이 다음 조회부터 자동으로 새 파일을 보게 된다(참조를 다시 매핑할 필요 없음).
   * file 파트를 생략하면 이름만 바뀐다.
   */
  @Roles("ADMIN")
  @Patch(":id")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: imageStorage,
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const extension = extname(file.originalname).toLowerCase();
        cb(null, ALLOWED_IMAGE_TYPES.get(extension) === file.mimetype);
      },
    }),
  )
  async update(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { name?: string; description?: string; widthPx?: string; heightPx?: string },
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    if (!file) {
      const { image } = await this.images.update(id, { name: body.name, description: body.description }, auth);
      return image;
    }

    const extension = extname(file.originalname).toLowerCase();
    try {
      if (!(await hasValidImageSignature(file.path, extension))) {
        throw new BadRequestException("uploaded file content does not match its image extension");
      }
      const { image, previousImageUrl } = await this.images.update(
        id,
        {
          name: body.name,
          description: body.description,
          imageUrl: `/uploads/images/${file.filename}`,
          widthPx: body.widthPx !== undefined ? Number(body.widthPx) : undefined,
          heightPx: body.heightPx !== undefined ? Number(body.heightPx) : undefined,
        },
        auth,
      );
      if (previousImageUrl) {
        // 새 파일 커밋 성공 후에만 이전 파일을 지운다(중간 실패 시 이전 파일 보존).
        await unlink(join(IMAGES_DIR, basename(previousImageUrl))).catch(() => undefined);
      }
      return image;
    } catch (error) {
      await unlink(file.path).catch(() => undefined);
      throw error;
    }
  }

  @Roles("ADMIN")
  @Delete(":id")
  async remove(@Param("id") id: string, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    const { imageUrl } = await this.images.remove(id, auth);
    // imageUrl = "/uploads/images/<file>" — 경로 조작 방지 위해 basename만 사용해 삭제.
    await unlink(join(IMAGES_DIR, basename(imageUrl))).catch(() => undefined);
    return { deleted: true };
  }
}
