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

  /** 지역(=area) 목록 — 관제/기기관리/지역관리 화면의 1차 탐색 단위(2026-07-15 합의). */
  @Roles("USER", "MONITOR", "HITL_APPROVER")
  @Get("areas")
  listAreas(@CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.spatial.listAreas(auth);
  }

  @Roles("USER", "MONITOR", "HITL_APPROVER")
  @Get("areas/:id/overview")
  areaOverview(@Param("id") id: string, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.spatial.areaOverview(id, auth);
  }

  /**
   * 지역 생성 — floorId(기존 층 태그) 또는 floorName(새 층 태그)을 받는다. 사용자에게는 "지역"
   * 하나의 개념만 노출하고, floor는 내부적으로 find-or-create되는 태그다. ADMIN 전용, 감사 대상.
   */
  @Roles("ADMIN")
  @Post("areas")
  createArea(
    @Body() body: { name: string; floorId?: string; floorName?: string; slug?: string },
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.spatial.createArea(body, auth);
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

  /** 도면 편집 모드 — 기기 위치 일괄 저장(지역=area 단위). ADMIN 전용(SRS 2.1, PROJECT_RULES §6). */
  @Roles("ADMIN")
  @Patch("areas/:id/layout")
  saveAreaLayout(
    @Param("id") id: string,
    @Body() body: SaveLayoutRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.spatial.saveAreaLayout(id, body, auth);
  }

  /** 층 태그 목록 — 전체 모니터링 층별 집계 + 지역 생성 시 층 선택 콤보박스용. */
  @Roles("USER", "MONITOR", "HITL_APPROVER")
  @Get("floors")
  listFloors(): Promise<unknown> {
    return this.spatial.listFloors();
  }

  /** 층에 이미 소속된 area 아래에 area를 추가하는 하위 호환 경로(분전반 등 향후 확장용). */
  @Roles("ADMIN")
  @Post("floors/:id/areas")
  createAreaUnderFloor(
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
    return this.spatial.createAreaUnderFloor(id, body, auth);
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
}
