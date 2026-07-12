import { Controller, Get, Param } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { CurrentAuth, Roles } from "../auth/auth.decorators.js";
import { GroupsService } from "../services/groups.service.js";

@Controller("api/v1/groups")
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Roles("USER", "MONITOR", "HITL_APPROVER")
  @Get("control")
  listControlSummaries(@CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.groups.listControlSummaries(auth);
  }

  @Roles("USER", "MONITOR", "HITL_APPROVER")
  @Get(":groupId/devices")
  listControlDevices(
    @Param("groupId") groupId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.groups.listControlDevices(groupId, auth);
  }
}
