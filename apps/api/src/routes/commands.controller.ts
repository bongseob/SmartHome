import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { CurrentAuth, RequireDeviceAccess, Roles } from "../auth/auth.decorators.js";
import { CommandsService, type CreateCommandRequest } from "../services/commands.service.js";

@Controller("api/v1/commands")
export class CommandsController {
  constructor(private readonly commands: CommandsService) {}

  @Roles("USER", "HITL_APPROVER")
  @RequireDeviceAccess("CONTROL", "bodyTarget")
  @Post()
  create(@Body() body: CreateCommandRequest, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.commands.create(body, auth);
  }

  @Roles("USER", "MONITOR", "HITL_APPROVER")
  @Get(":commandId")
  get(@Param("commandId") commandId: string): Promise<unknown> {
    return this.commands.get(commandId);
  }
}
