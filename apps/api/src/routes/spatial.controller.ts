import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
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
}
