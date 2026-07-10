import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { CurrentAuth, Roles } from "../auth/auth.decorators.js";
import {
  AlarmPoliciesService,
  type CreateAlarmPolicyRequest,
} from "../services/alarm-policies.service.js";

/** SRS 2.1.5 — 알람 정책 관리는 ADMIN 전용. */
@Controller("api/v1/alarm-policies")
export class AlarmPoliciesController {
  constructor(private readonly policies: AlarmPoliciesService) {}

  @Roles("ADMIN")
  @Get()
  list(): Promise<unknown> {
    return this.policies.list();
  }

  @Roles("ADMIN")
  @Post()
  create(@Body() body: CreateAlarmPolicyRequest, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.policies.create(body, auth);
  }

  @Roles("ADMIN")
  @Patch(":id/enabled")
  setEnabled(
    @Param("id") id: string,
    @Body() body: { enabled: boolean },
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.policies.setEnabled(id, body.enabled, auth);
  }
}
