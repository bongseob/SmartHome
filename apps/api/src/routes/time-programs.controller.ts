import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { CurrentAuth, Roles } from "../auth/auth.decorators.js";
import {
  TimeProgramsService,
  type AddSlotRequest,
  type CreateTimeProgramRequest,
} from "../services/time-programs.service.js";

/** addendum §6.2·§6.3 · PROJECT_RULES §6 — 타임프로그램 관리는 ADMIN 전용. */
@Controller("api/v1/time-programs")
export class TimeProgramsController {
  constructor(private readonly programs: TimeProgramsService) {}

  @Roles("ADMIN")
  @Get()
  list(): Promise<unknown> {
    return this.programs.list();
  }

  @Roles("ADMIN")
  @Get(":id")
  detail(@Param("id") id: string): Promise<unknown> {
    return this.programs.getDetail(id);
  }

  @Roles("ADMIN")
  @Post()
  create(@Body() body: CreateTimeProgramRequest, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.programs.create(body, auth);
  }

  @Roles("ADMIN")
  @Patch(":id/enabled")
  setEnabled(
    @Param("id") id: string,
    @Body() body: { enabled: boolean },
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.programs.setEnabled(id, body.enabled, auth);
  }

  @Roles("ADMIN")
  @Delete(":id")
  remove(@Param("id") id: string, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.programs.remove(id, auth);
  }

  // ─── Slots ───────────────────────────────────────────────
  @Roles("ADMIN")
  @Post(":id/slots")
  addSlot(
    @Param("id") id: string,
    @Body() body: AddSlotRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.programs.addSlot(id, body, auth);
  }

  @Roles("ADMIN")
  @Delete(":id/slots/:slotId")
  removeSlot(
    @Param("id") id: string,
    @Param("slotId") slotId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.programs.removeSlot(id, slotId, auth);
  }

  // ─── Group mapping (스케줄 등록) ─────────────────────────
  @Roles("ADMIN")
  @Post(":id/groups")
  mapGroup(
    @Param("id") id: string,
    @Body() body: { groupId: string },
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.programs.mapGroup(id, body.groupId, auth);
  }

  @Roles("ADMIN")
  @Delete(":id/groups/:groupId")
  unmapGroup(
    @Param("id") id: string,
    @Param("groupId") groupId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.programs.unmapGroup(id, groupId, auth);
  }
}
