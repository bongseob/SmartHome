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
  updateScheduler,
  withTransaction,
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
  /** 기본 false(cron과 동일 — 다운타임 캐치업 없음). true면 최대 10분까지 늦은 발화도 실행한다. */
  catchUpEnabled?: boolean;
}

/** SRS 2.1.5 · PROJECT_RULES §6 — 스케줄러 관리는 ADMIN 전용, 변경은 감사 대상. */
@Injectable()
export class SchedulersService {
  async list(): Promise<unknown> {
    return listSchedulers(schedulerExecutor);
  }

  // 업무 변경과 insertAuditLog를 같은 트랜잭션으로 묶는다 — 예전엔 별도 호출이라 audit
  // insert가 실패해도 변경만 남을 수 있었다(코드 리뷰 P1 #3).
  async create(body: CreateSchedulerRequest, auth: AuthContext): Promise<unknown> {
    return withTransaction(async (client) => {
      const scheduler = await createScheduler(client, {
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
        catchUpEnabled: body.catchUpEnabled ?? false,
      });
      await insertAuditLog(client, {
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
    });
  }

  async update(id: string, body: CreateSchedulerRequest, auth: AuthContext): Promise<unknown> {
    return withTransaction(async (client) => {
      const scheduler = await updateScheduler(client, id, {
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
        catchUpEnabled: body.catchUpEnabled ?? false,
      });
      if (!scheduler) {
        throw new NotFoundException(`scheduler not found: ${id}`);
      }
      await insertAuditLog(client, {
        actorType: "ADMIN",
        actorId: auth.userId,
        targetType: "SCHEDULER",
        targetId: scheduler.id,
        command: "UPDATE_SCHEDULER",
        reason: `scheduler '${scheduler.name}' updated`,
        executionStatus: "SUCCEEDED",
        mqttReasonCode: null,
        sessionId: null,
        commandId: null,
      });
      return scheduler;
    });
  }

  async setEnabled(id: string, enabled: boolean, auth: AuthContext): Promise<unknown> {
    return withTransaction(async (client) => {
      const scheduler = await setSchedulerEnabled(client, id, enabled);
      if (!scheduler) {
        throw new NotFoundException(`scheduler not found: ${id}`);
      }
      await insertAuditLog(client, {
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
    });
  }

  async remove(id: string, auth: AuthContext): Promise<unknown> {
    return withTransaction(async (client) => {
      const deleted = await deleteScheduler(client, id);
      if (!deleted) {
        throw new NotFoundException(`scheduler not found: ${id}`);
      }
      await insertAuditLog(client, {
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
    });
  }

  async runs(id: string, limit?: string): Promise<unknown> {
    const parsedLimit = limit ? Number(limit) : 20;
    return listRunsForScheduler(schedulerExecutor, id, Number.isFinite(parsedLimit) ? parsedLimit : 20);
  }
}
