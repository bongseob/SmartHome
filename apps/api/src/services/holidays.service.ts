import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { LunarSolar } from "@smarthome/contracts";
import type { AuthContext } from "@smarthome/auth";
import {
  createHoliday,
  deleteHoliday,
  insertAuditLog,
  listHolidays,
  query,
  updateHoliday,
  type CreateHolidayInput,
} from "@smarthome/db";

const holidayExecutor = { query };

/** Postgres unique_violation. holiday(month, day, lunar_solar, name) 중복 등록 방지. */
const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err &&
    (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION;
}

export interface HolidayRequest {
  month: number;
  day: number;
  lunarSolar: string;
  name: string;
}

/** SRS 3.4 지원 데이터 · addendum §7 — 휴일 관리는 ADMIN 전용, 변경은 감사 대상. */
@Injectable()
export class HolidaysService {
  async list(lunarSolarFilter?: string): Promise<unknown> {
    const filter: { lunarSolar?: LunarSolar } = {};
    if (lunarSolarFilter !== undefined) {
      const parsed = LunarSolar.safeParse(lunarSolarFilter);
      if (!parsed.success) {
        throw new BadRequestException(`invalid lunarSolar: ${lunarSolarFilter}`);
      }
      filter.lunarSolar = parsed.data;
    }
    return listHolidays(holidayExecutor, filter);
  }

  async create(body: HolidayRequest, auth: AuthContext): Promise<unknown> {
    const input = this.validate(body);
    let holiday;
    try {
      holiday = await createHoliday(holidayExecutor, input);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `holiday already exists: ${input.month}/${input.day} ${input.lunarSolar} '${input.name}'`,
        );
      }
      throw err;
    }
    await insertAuditLog(holidayExecutor, {
      actorType: "ADMIN",
      actorId: auth.userId,
      targetType: "HOLIDAY",
      targetId: holiday.id,
      command: "CREATE_HOLIDAY",
      reason: `holiday '${holiday.name}' (${holiday.month}/${holiday.day}, ${holiday.lunarSolar}) created`,
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
    });
    return holiday;
  }

  async update(id: string, body: HolidayRequest, auth: AuthContext): Promise<unknown> {
    const input = this.validate(body);
    let holiday;
    try {
      holiday = await updateHoliday(holidayExecutor, id, input);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `holiday already exists: ${input.month}/${input.day} ${input.lunarSolar} '${input.name}'`,
        );
      }
      throw err;
    }
    if (!holiday) {
      throw new NotFoundException(`holiday not found: ${id}`);
    }
    await insertAuditLog(holidayExecutor, {
      actorType: "ADMIN",
      actorId: auth.userId,
      targetType: "HOLIDAY",
      targetId: holiday.id,
      command: "UPDATE_HOLIDAY",
      reason: `holiday '${holiday.name}' (${holiday.month}/${holiday.day}, ${holiday.lunarSolar}) updated`,
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
    });
    return holiday;
  }

  async remove(id: string, auth: AuthContext): Promise<unknown> {
    const deleted = await deleteHoliday(holidayExecutor, id);
    if (!deleted) {
      throw new NotFoundException(`holiday not found: ${id}`);
    }
    await insertAuditLog(holidayExecutor, {
      actorType: "ADMIN",
      actorId: auth.userId,
      targetType: "HOLIDAY",
      targetId: id,
      command: "DELETE_HOLIDAY",
      reason: `holiday ${id} deleted`,
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
    });
    return { deleted: true };
  }

  /** month 1–12, day 1–31, lunarSolar enum, name 필수. DB CHECK와 일관되게 API에서 먼저 400 처리. */
  private validate(body: HolidayRequest): CreateHolidayInput {
    if (!Number.isInteger(body.month) || body.month < 1 || body.month > 12) {
      throw new BadRequestException(`month must be an integer 1–12: ${body.month}`);
    }
    if (!Number.isInteger(body.day) || body.day < 1 || body.day > 31) {
      throw new BadRequestException(`day must be an integer 1–31: ${body.day}`);
    }
    const parsed = LunarSolar.safeParse(body.lunarSolar);
    if (!parsed.success) {
      throw new BadRequestException(`lunarSolar must be SOLAR or LUNAR: ${body.lunarSolar}`);
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length === 0) {
      throw new BadRequestException("name is required");
    }
    return { month: body.month, day: body.day, lunarSolar: parsed.data, name };
  }
}
