import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { CurrentAuth, Roles } from "../auth/auth.decorators.js";
import {
  SchedulersService,
  type CreateSchedulerRequest,
} from "../services/schedulers.service.js";

/** SRS 3.4 · PROJECT_RULES §6 — 스케줄러 관리는 ADMIN 전용. */
@Controller("api/v1/schedulers")
export class SchedulersController {
  constructor(private readonly schedulers: SchedulersService) {}

  @Roles("ADMIN")
  @Get()
  list(): Promise<unknown> {
    return this.schedulers.list();
  }

  @Roles("ADMIN")
  @Post()
  create(@Body() body: CreateSchedulerRequest, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.schedulers.create(body, auth);
  }

  @Roles("ADMIN")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: CreateSchedulerRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.schedulers.update(id, body, auth);
  }

  @Roles("ADMIN")
  @Patch(":id/enabled")
  setEnabled(
    @Param("id") id: string,
    @Body() body: { enabled: boolean },
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.schedulers.setEnabled(id, body.enabled, auth);
  }

  @Roles("ADMIN")
  @Delete(":id")
  remove(@Param("id") id: string, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.schedulers.remove(id, auth);
  }

  @Roles("ADMIN")
  @Get(":id/runs")
  runs(@Param("id") id: string, @Query("limit") limit?: string): Promise<unknown> {
    return this.schedulers.runs(id, limit);
  }
}
