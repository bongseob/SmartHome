import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import cronParser from "cron-parser";
import { ScheduleType, TargetType } from "@smarthome/contracts";
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
    this.validate(body);
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
    this.validate(body);
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

  /**
   * 예전엔 TypeScript interface 타입만 있고 런타임 검증이 없어서, 잘못된 enum이 DB 제약
   * 위반 500으로 터지거나(target_type/schedule_type), 잘못된 cron/date가 DB에는 그냥
   * 저장돼서 apps/scheduler의 computeDueState가 조용히 "NOT_DUE"로만 처리해 영원히 발화하지
   * 않는 실행 불가능한 스케줄이 만들어질 수 있었다(코드 리뷰 P2 #14). scheduleType별로 실제
   * 발화 판정(schedule-math.ts computeDueState)에 필요한 필드를 저장 전에 검증한다.
   */
  private validate(body: CreateSchedulerRequest): void {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new BadRequestException("name은 필수입니다.");

    const targetType = TargetType.safeParse(body.targetType);
    if (!targetType.success) {
      throw new BadRequestException(`targetType은 ${TargetType.options.join(", ")} 중 하나여야 합니다.`);
    }
    if (!body.targetId?.trim()) {
      throw new BadRequestException("targetId는 필수입니다.");
    }

    const scheduleType = ScheduleType.safeParse(body.scheduleType);
    if (!scheduleType.success) {
      throw new BadRequestException(`scheduleType은 ${ScheduleType.options.join(", ")} 중 하나여야 합니다.`);
    }

    if (typeof body.payload !== "object" || body.payload === null) {
      throw new BadRequestException("payload는 필수입니다.");
    }
    if (typeof (body.payload as { command?: unknown }).command !== "string") {
      throw new BadRequestException("payload.command는 필수 문자열입니다.");
    }

    switch (scheduleType.data) {
      case "ONE_TIME":
      case "DAILY":
        this.assertValidRunAt(body.runAt);
        break;
      case "WEEKLY":
        this.assertValidRunAt(body.runAt);
        if (
          !Array.isArray(body.daysOfWeek) ||
          body.daysOfWeek.length === 0 ||
          !body.daysOfWeek.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        ) {
          throw new BadRequestException("WEEKLY는 daysOfWeek(0~6 정수 배열, 0=일)가 필요합니다.");
        }
        break;
      case "MONTHLY":
        this.assertValidRunAt(body.runAt);
        if (!Number.isInteger(body.dayOfMonth) || (body.dayOfMonth as number) < 1 || (body.dayOfMonth as number) > 31) {
          throw new BadRequestException("MONTHLY는 dayOfMonth(1~31 정수)가 필요합니다.");
        }
        break;
      case "CRON":
        if (!body.cronExpr?.trim()) {
          throw new BadRequestException("CRON은 cronExpr이 필요합니다.");
        }
        try {
          cronParser.parseExpression(body.cronExpr, { utc: true });
        } catch {
          throw new BadRequestException(`유효하지 않은 cron 식입니다: ${body.cronExpr}`);
        }
        break;
      case "EVENT":
        // 이벤트 소스 미구현 — apps/scheduler가 스킵하므로 추가 필드 검증 없음.
        break;
    }
  }

  private assertValidRunAt(runAt: string | undefined): void {
    if (!runAt) {
      throw new BadRequestException("이 scheduleType은 runAt(ISO datetime)이 필요합니다.");
    }
    if (Number.isNaN(new Date(runAt).getTime())) {
      throw new BadRequestException(`runAt은 유효한 ISO datetime이어야 합니다: ${runAt}`);
    }
  }
}
