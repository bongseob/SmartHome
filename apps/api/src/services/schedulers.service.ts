import { Injectable, NotFoundException } from "@nestjs/common";
import type { ScheduleType, TargetType } from "@smarthome/contracts";
import type { AuthContext } from "@smarthome/auth";
import {
  createScheduler,
  deleteScheduler,
  insertAuditLog,
  listRunsForScheduler,
  listSchedulers,
  query,
  setSchedulerEnabled,
} from "@smarthome/db";

const schedulerExecutor = { query };

export interface CreateSchedulerRequest {
  name: string;
  targetType: TargetType;
  targetId: string;
  scheduleType: ScheduleType;
  runAt?: string;
  cronExpr?: string;
  daysOfWeek?: number[];
  dayOfMonth?: number;
  eventTrigger?: unknown;
  payload: Record<string, unknown>;
}

/** SRS 2.1.5 · PROJECT_RULES §6 — 스케줄러 관리는 ADMIN 전용, 변경은 감사 대상. */
@Injectable()
export class SchedulersService {
  async list(): Promise<unknown> {
    return listSchedulers(schedulerExecutor);
  }

  async create(body: CreateSchedulerRequest, auth: AuthContext): Promise<unknown> {
    const scheduler = await createScheduler(schedulerExecutor, {
      name: body.name,
      targetType: body.targetType,
      targetId: body.targetId,
      scheduleType: body.scheduleType,
      runAt: body.runAt ? new Date(body.runAt) : null,
      cronExpr: body.cronExpr ?? null,
      daysOfWeek: body.daysOfWeek ?? null,
      dayOfMonth: body.dayOfMonth ?? null,
      eventTrigger: body.eventTrigger,
      payload: body.payload,
      createdBy: auth.userId,
    });
    await insertAuditLog(schedulerExecutor, {
      actorType: "ADMIN",
      actorId: auth.userId,
      targetType: "SCHEDULER",
      targetId: scheduler.id,
      command: "CREATE_SCHEDULER",
      reason: `scheduler '${scheduler.name}' created`,
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
    });
    return scheduler;
  }

  async setEnabled(id: string, enabled: boolean, auth: AuthContext): Promise<unknown> {
    const scheduler = await setSchedulerEnabled(schedulerExecutor, id, enabled);
    if (!scheduler) {
      throw new NotFoundException(`scheduler not found: ${id}`);
    }
    await insertAuditLog(schedulerExecutor, {
      actorType: "ADMIN",
      actorId: auth.userId,
      targetType: "SCHEDULER",
      targetId: scheduler.id,
      command: enabled ? "ENABLE_SCHEDULER" : "DISABLE_SCHEDULER",
      reason: `scheduler '${scheduler.name}' ${enabled ? "enabled" : "disabled"}`,
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
    });
    return scheduler;
  }

  async remove(id: string, auth: AuthContext): Promise<unknown> {
    const deleted = await deleteScheduler(schedulerExecutor, id);
    if (!deleted) {
      throw new NotFoundException(`scheduler not found: ${id}`);
    }
    await insertAuditLog(schedulerExecutor, {
      actorType: "ADMIN",
      actorId: auth.userId,
      targetType: "SCHEDULER",
      targetId: id,
      command: "DELETE_SCHEDULER",
      reason: `scheduler ${id} deleted`,
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
    });
    return { deleted: true };
  }

  async runs(id: string, limit?: string): Promise<unknown> {
    const parsedLimit = limit ? Number(limit) : 20;
    return listRunsForScheduler(schedulerExecutor, id, Number.isFinite(parsedLimit) ? parsedLimit : 20);
  }
}
