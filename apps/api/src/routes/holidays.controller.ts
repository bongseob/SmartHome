import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { CurrentAuth, Roles } from "../auth/auth.decorators.js";
import { HolidaysService, type HolidayRequest } from "../services/holidays.service.js";

/** addendum §7 · PROJECT_RULES §6 — 휴일 관리는 ADMIN 전용. */
@Controller("api/v1/holidays")
export class HolidaysController {
  constructor(private readonly holidays: HolidaysService) {}

  @Roles("ADMIN")
  @Get()
  list(@Query("lunarSolar") lunarSolar?: string): Promise<unknown> {
    return this.holidays.list(lunarSolar);
  }

  @Roles("ADMIN")
  @Post()
  create(@Body() body: HolidayRequest, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.holidays.create(body, auth);
  }

  @Roles("ADMIN")
  @Put(":id")
  update(
    @Param("id") id: string,
    @Body() body: HolidayRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.holidays.update(id, body, auth);
  }

  @Roles("ADMIN")
  @Delete(":id")
  remove(@Param("id") id: string, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.holidays.remove(id, auth);
  }
}
