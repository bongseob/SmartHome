import { Controller, Get, Param } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { CurrentAuth, Roles } from "../auth/auth.decorators.js";
import { SpatialService } from "../services/spatial.service.js";

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
}
