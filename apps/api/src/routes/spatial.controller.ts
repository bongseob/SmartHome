import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { CurrentAuth, Roles } from "../auth/auth.decorators.js";
import { SpatialService, type SaveLayoutRequest } from "../services/spatial.service.js";

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
  @Patch("floor-maps/:id")
  updateFloorMapScale(
    @Param("id") id: string,
    @Body() body: { scaleMPerPx: number },
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.spatial.updateFloorMapScale(id, Number(body.scaleMPerPx), auth);
  }

  /** 등록된 이미지 라이브러리 항목을 별도 매핑 과정으로 층 배경 도면에 적용한다. */
  @Roles("ADMIN")
  @Patch("floors/:id/floor-map-image")
  assignFloorMapImage(
    @Param("id") id: string,
    @Body() body: { imageId: string; scaleMPerPx: number },
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.spatial.assignFloorMapImage(id, body.imageId, Number(body.scaleMPerPx), auth);
  }

  /** 지역(Area) 관리(M16, SRS 2.1.1) — 생성/수정/삭제. ADMIN 전용, 감사 대상. */
  @Roles("ADMIN")
  @Post("floors/:id/areas")
  createArea(
    @Param("id") id: string,
    @Body()
    body: {
      name: string;
      polygon: unknown;
      slug?: string;
      kind?: string;
      imageId?: string | null;
      posX?: number | null;
      posY?: number | null;
    },
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.spatial.createArea(id, body, auth);
  }

  @Roles("ADMIN")
  @Patch("areas/:id")
  updateArea(
    @Param("id") id: string,
    @Body()
    body: {
      name?: string;
      polygon?: unknown;
      kind?: string;
      imageId?: string | null;
      posX?: number | null;
      posY?: number | null;
    },
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
