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
import { extname } from "node:path";
import type { AuthContext } from "@smarthome/auth";
import { CurrentAuth, Roles } from "../auth/auth.decorators.js";
import { SpatialService, type SaveLayoutRequest } from "../services/spatial.service.js";
import { ensureFloorMapsDir } from "../config/uploads.js";

const ALLOWED_IMAGE_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

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

const floorMapStorage = diskStorage({
  destination: (_req, _file, cb) => cb(null, ensureFloorMapsDir()),
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
});

@Controller("api/v1/spatial")
export class SpatialController {
  constructor(private readonly spatial: SpatialService) {}

  @Roles("USER", "MONITOR", "HITL_APPROVER")
  @Get("floors")
  listFloors(@CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.spatial.listFloors(auth);
  }

  @Roles("USER", "MONITOR", "HITL_APPROVER")
  @Get("floors/:id/overview")
  floorOverview(@Param("id") id: string, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.spatial.floorOverview(id, auth);
  }

  /** 도면 편집 모드 — 기기 위치 일괄 저장. 공간/기기 관리는 ADMIN 전용(SRS 2.1, PROJECT_RULES §6). */
  @Roles("ADMIN")
  @Patch("floors/:id/layout")
  saveLayout(
    @Param("id") id: string,
    @Body() body: SaveLayoutRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.spatial.saveLayout(id, body, auth);
  }

  /** 시스템 기본정보 관리(M16, SRS 2.1.1) — Site/Building 이름만 수정 가능. ADMIN 전용. */
  @Roles("ADMIN")
  @Get("sites")
  listSites(): Promise<unknown> {
    return this.spatial.listSites();
  }

  @Roles("ADMIN")
  @Patch("sites/:id")
  updateSiteName(
    @Param("id") id: string,
    @Body() body: { name: string },
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.spatial.updateSiteName(id, body.name, auth);
  }

  @Roles("ADMIN")
  @Get("buildings")
  listBuildings(): Promise<unknown> {
    return this.spatial.listBuildings();
  }

  @Roles("ADMIN")
  @Patch("buildings/:id")
  updateBuildingName(
    @Param("id") id: string,
    @Body() body: { name: string },
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.spatial.updateBuildingName(id, body.name, auth);
  }

  /**
   * 도면(Floor Map) 업로드(M16, SRS 2.1.1) — 이미지는 로컬 파일시스템에 저장한다(부록 A.1 결정).
   * width/height는 프런트가 <img> onload로 읽은 실제 픽셀 크기를 함께 보낸다(서버는 이미지를
   * 파싱하지 않는다 — 별도 이미지 라이브러리 의존성 없이 단순화).
   */
  @Roles("ADMIN")
  @Post("floors/:id/floor-map")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: floorMapStorage,
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const extension = extname(file.originalname).toLowerCase();
        cb(null, ALLOWED_IMAGE_TYPES.get(extension) === file.mimetype);
      },
    }),
  )
  async uploadFloorMap(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { widthPx: string; heightPx: string; scaleMPerPx: string },
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
      return await this.spatial.uploadFloorMap(
        id,
        `/uploads/floor-maps/${file.filename}`,
        {
          widthPx: Number(body.widthPx),
          heightPx: Number(body.heightPx),
          scaleMPerPx: Number(body.scaleMPerPx),
        },
        auth,
      );
    } catch (error) {
      await unlink(file.path).catch(() => undefined);
      throw error;
    }
  }

  @Roles("ADMIN")
  @Patch("floor-maps/:id")
  updateFloorMapScale(
    @Param("id") id: string,
    @Body() body: { scaleMPerPx: number },
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.spatial.updateFloorMapScale(id, Number(body.scaleMPerPx), auth);
  }

  /** 지역(Area) 관리(M16, SRS 2.1.1) — 생성/수정/삭제. ADMIN 전용, 감사 대상. */
  @Roles("ADMIN")
  @Post("floors/:id/areas")
  createArea(
    @Param("id") id: string,
    @Body() body: { name: string; polygon: unknown; slug?: string },
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.spatial.createArea(id, body, auth);
  }

  @Roles("ADMIN")
  @Patch("areas/:id")
  updateArea(
    @Param("id") id: string,
    @Body() body: { name?: string; polygon?: unknown },
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.spatial.updateArea(id, body, auth);
  }

  @Roles("ADMIN")
  @Delete("areas/:id")
  deleteArea(@Param("id") id: string, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.spatial.deleteArea(id, auth);
  }
}
