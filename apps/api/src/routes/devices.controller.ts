import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { CurrentAuth, RequireDeviceAccess, Roles } from "../auth/auth.decorators.js";
import {
  DevicesService,
  type CreateDeviceRequest,
  type SetDeviceConnectionRequest,
  type SetDeviceMonitoringRequest,
  type UpdateDeviceRequest,
} from "../services/devices.service.js";

@Controller("api/v1/devices")
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Roles("USER", "MONITOR", "HITL_APPROVER")
  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query("areaId") areaId?: string,
    @Query("category") category?: string,
    @Query("status") status?: string,
  ): Promise<unknown> {
    const filter: Record<string, string> = {};
    if (areaId) filter.areaId = areaId;
    if (category) filter.category = category;
    if (status) filter.status = status;
    return this.devices.list(filter, auth);
  }

  /** 기기 생성 — ADMIN 전용(SRS 2.1.2). mqtt_topic은 buildDeviceBase()로 자동 생성. */
  @Roles("ADMIN")
  @Post()
  create(@Body() body: CreateDeviceRequest, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.devices.create(body, auth);
  }

  @Roles("USER", "MONITOR", "HITL_APPROVER")
  @RequireDeviceAccess("VIEW", "routeParam", "id")
  @Get(":id/state")
  state(@Param("id") id: string): Promise<unknown> {
    return this.devices.state(id);
  }

  @Roles("USER", "MONITOR", "HITL_APPROVER")
  @RequireDeviceAccess("VIEW", "routeParam", "id")
  @Get(":id/history")
  history(@Param("id") id: string, @Query("limit") limit?: string): Promise<unknown> {
    return this.devices.history(id, limit);
  }

  /** 기기 기본 필드 수정 — ADMIN 전용. area/code/mqtt_topic은 불변. */
  @Roles("ADMIN")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: UpdateDeviceRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.devices.update(id, body, auth);
  }

  /** 기기 폐기(소프트 전이) — ADMIN 전용. lifecycle_status → DECOMMISSIONED. */
  @Roles("ADMIN")
  @Patch(":id/decommission")
  decommission(@Param("id") id: string, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.devices.decommission(id, auth);
  }

  /** Device↔Gateway 연결 프로토콜 설정 — 공간/기기 관리는 ADMIN 전용(SRS 2.1.2). */
  @Roles("ADMIN")
  @Patch(":id/connection")
  setConnection(
    @Param("id") id: string,
    @Body() body: SetDeviceConnectionRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.devices.setConnection(id, body, auth);
  }

  /** 모니터링 표시/사용 여부 설정 — ADMIN 전용. 숨김/미사용 기기는 관제 화면에서 제외된다. */
  @Roles("ADMIN")
  @Patch(":id/monitoring")
  setMonitoring(
    @Param("id") id: string,
    @Body() body: SetDeviceMonitoringRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.devices.setMonitoring(id, body, auth);
  }
}
