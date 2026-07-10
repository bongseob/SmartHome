import { Body, Controller, Get, Param, Patch, Query } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { CurrentAuth, RequireDeviceAccess, Roles } from "../auth/auth.decorators.js";
import { DevicesService, type SetDeviceConnectionRequest } from "../services/devices.service.js";

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
}
