import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { CurrentAuth, RequireDeviceAccess, Roles } from "../auth/auth.decorators.js";
import {
  CamerasService,
  type CreateCameraPresetRequest,
  type CreateCameraRequest,
  type UpdateCameraRequest,
} from "../services/cameras.service.js";

/** 카메라 관리(api-spec.md §4-cam) — 목록/조회는 VIEW, 등록·설정·프리셋·커버리지는 ADMIN 전용. */
@Controller("api/v1/cameras")
export class CamerasController {
  constructor(private readonly cameras: CamerasService) {}

  @Roles("USER", "MONITOR", "HITL_APPROVER")
  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query("areaId") areaId?: string,
    @Query("isPtz") isPtz?: string,
  ): Promise<unknown> {
    const filter: { areaId?: string; isPtz?: boolean } = {};
    if (areaId) filter.areaId = areaId;
    if (isPtz !== undefined) filter.isPtz = isPtz === "true";
    return this.cameras.list(filter, auth);
  }

  @Roles("USER", "MONITOR", "HITL_APPROVER")
  @RequireDeviceAccess("VIEW", "routeParam", "id")
  @Get(":id")
  get(@Param("id") id: string): Promise<unknown> {
    return this.cameras.get(id);
  }

  /** 서명된 단기 스트림 URL 발급(§5-cam) — 영상은 여기(api)를 거치지 않고 media-gateway/MediaMTX가 직접 서빙. */
  @Roles("USER", "MONITOR", "HITL_APPROVER")
  @RequireDeviceAccess("VIEW", "routeParam", "id")
  @Get(":id/stream")
  getStream(@Param("id") id: string): Promise<unknown> {
    return this.cameras.getStreamUrl(id);
  }

  /** 카메라 등록 — ADMIN 전용. device+camera row를 함께 만든다(devices.service.ts의 create()는
   *  category=CAMERA를 거부하고 여기로 위임하도록 설계돼 있다). */
  @Roles("ADMIN")
  @Post()
  create(@Body() body: CreateCameraRequest, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.cameras.create(body, auth);
  }

  /** 스트림·PTZ·설치 방향 설정 수정 — ADMIN 전용. 이름 변경 등은 PATCH /devices/:id 재사용. */
  @Roles("ADMIN")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: UpdateCameraRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.cameras.update(id, body, auth);
  }

  @Roles("USER", "MONITOR", "HITL_APPROVER")
  @RequireDeviceAccess("VIEW", "routeParam", "id")
  @Get(":id/presets")
  listPresets(@Param("id") id: string): Promise<unknown> {
    return this.cameras.listPresets(id);
  }

  @Roles("ADMIN")
  @Post(":id/presets")
  createPreset(
    @Param("id") id: string,
    @Body() body: CreateCameraPresetRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.cameras.createPreset(id, body, auth);
  }

  @Roles("ADMIN")
  @Put(":id/coverage/areas/:areaId")
  addCoverage(
    @Param("id") id: string,
    @Param("areaId") areaId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.cameras.addCoverage(id, areaId, auth);
  }

  @Roles("ADMIN")
  @Delete(":id/coverage/areas/:areaId")
  removeCoverage(
    @Param("id") id: string,
    @Param("areaId") areaId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.cameras.removeCoverage(id, areaId, auth);
  }

  /** PTZ 이동 — 일반 명령 흐름(mqtt-command 스킬) 재사용. `{pan,tilt,zoom}` 또는 `{stop:true}`. */
  @Roles("USER", "HITL_APPROVER")
  @RequireDeviceAccess("CONTROL", "routeParam", "id")
  @Post(":id/ptz")
  ptz(@Param("id") id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.cameras.ptz(id, body, auth);
  }

  @Roles("USER", "HITL_APPROVER")
  @RequireDeviceAccess("CONTROL", "routeParam", "id")
  @Post(":id/presets/:presetId/goto")
  gotoPreset(
    @Param("id") id: string,
    @Param("presetId") presetId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.cameras.gotoPreset(id, presetId, auth);
  }
}
