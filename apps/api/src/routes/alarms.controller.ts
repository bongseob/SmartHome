import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import type { AlarmState, AlarmTier, Severity } from "@smarthome/contracts";
import type { AuthContext } from "@smarthome/auth";
import { CurrentAuth, Roles } from "../auth/auth.decorators.js";
import {
  AlarmsService,
  type AlarmActionRequest,
  type AlarmListFilterRequest,
  type AlarmNoteRequest,
  type AlarmSnoozeRequest,
} from "../services/alarms.service.js";

@Controller("api/v1/alarms")
export class AlarmsController {
  constructor(private readonly alarms: AlarmsService) {}

  @Roles("USER", "MONITOR", "HITL_APPROVER")
  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query("state") state?: AlarmState,
    @Query("tier") tier?: AlarmTier,
    @Query("severity") severity?: Severity,
    @Query("deviceId") deviceId?: string,
  ): Promise<unknown> {
    const filter: AlarmListFilterRequest = {};
    if (state) filter.state = state;
    if (tier) filter.tier = tier;
    if (severity) filter.severity = severity;
    if (deviceId) filter.deviceId = deviceId;
    return this.alarms.list(filter, auth);
  }

  @Roles("USER", "MONITOR", "HITL_APPROVER")
  @Get(":id")
  get(@Param("id") id: string, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.alarms.get(id, auth);
  }

  /** 알람 발생원을 커버하는 카메라 목록(현장 확인용, §5-cam). */
  @Roles("USER", "MONITOR", "HITL_APPROVER")
  @Get(":id/cameras")
  getCameras(@Param("id") id: string, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.alarms.getCameras(id, auth);
  }

  @Roles("USER", "MONITOR", "HITL_APPROVER")
  @Post(":id/ack")
  ack(
    @Param("id") id: string,
    @CurrentAuth() auth: AuthContext,
    @Body() body: AlarmActionRequest,
  ): Promise<unknown> {
    return this.alarms.ack(id, auth, body ?? {});
  }

  @Roles("USER", "MONITOR", "HITL_APPROVER")
  @Post(":id/snooze")
  snooze(
    @Param("id") id: string,
    @CurrentAuth() auth: AuthContext,
    @Body() body: AlarmSnoozeRequest,
  ): Promise<unknown> {
    return this.alarms.snooze(id, auth, body);
  }

  @Roles("MONITOR", "HITL_APPROVER")
  @Post(":id/resolve")
  resolve(
    @Param("id") id: string,
    @CurrentAuth() auth: AuthContext,
    @Body() body: AlarmActionRequest,
  ): Promise<unknown> {
    return this.alarms.resolve(id, auth, body ?? {});
  }

  @Roles("MONITOR", "HITL_APPROVER")
  @Post(":id/note")
  note(
    @Param("id") id: string,
    @CurrentAuth() auth: AuthContext,
    @Body() body: AlarmNoteRequest,
  ): Promise<unknown> {
    return this.alarms.note(id, auth, body);
  }
}
