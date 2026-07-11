import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { CurrentAuth, RequireDeviceAccess, Roles } from "../auth/auth.decorators.js";
import {
  CommandsService,
  type CreateCommandRequest,
  type CreateGroupCommandRequest,
} from "../services/commands.service.js";

@Controller("api/v1/commands")
export class CommandsController {
  constructor(private readonly commands: CommandsService) {}

  @Roles("USER", "HITL_APPROVER")
  @RequireDeviceAccess("CONTROL", "bodyTarget")
  @Post()
  create(@Body() body: CreateCommandRequest, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.commands.create(body, auth);
  }

  /**
   * 그룹 일괄 제어(addendum §5) — 그룹 멤버를 순차 간격(기본 1.5초)으로 제어.
   * 그룹 단위 ACL(멤버 전 기기 CONTROL)은 서비스에서 검사하므로 @RequireDeviceAccess를 붙이지 않는다.
   */
  @Roles("USER", "HITL_APPROVER")
  @Post("group")
  createGroup(
    @Body() body: CreateGroupCommandRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.commands.createGroupBatch(body, auth);
  }

  @Roles("USER", "MONITOR", "HITL_APPROVER")
  @Get(":commandId")
  get(@Param("commandId") commandId: string): Promise<unknown> {
    return this.commands.get(commandId);
  }
}
