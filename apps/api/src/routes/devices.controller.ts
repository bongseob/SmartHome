import { Controller, Get, Param, Query } from "@nestjs/common";
import { RequireDeviceAccess, Roles } from "../auth/auth.decorators.js";
import { DevicesService } from "../services/devices.service.js";

@Controller("api/v1/devices")
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

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
}
