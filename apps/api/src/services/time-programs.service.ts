import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import {
  addTimeProgramSlot,
  createTimeProgram,
  deleteTimeProgram,
  deleteTimeProgramSlot,
  getTimeProgramById,
  insertAuditLog,
  listTimeProgramGroups,
  listTimePrograms,
  listTimeProgramSlots,
  mapTimeProgramGroup,
  query,
  setTimeProgramEnabled,
  unmapTimeProgramGroup,
  withTransaction,
  type QueryExecutor,
} from "@smarthome/db";

const tpExecutor = { query };

const PG_UNIQUE_VIOLATION = "23505";
const PG_FK_VIOLATION = "23503";

function pgCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const { code } = err as { code?: unknown };
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export interface CreateTimeProgramRequest {
  programNo: number;
  name: string;
}

export interface AddSlotRequest {
  dayOfWeek?: number | null;
  isHoliday?: boolean;
  atTime: string;
  powerOn: boolean;
}

/** addendum §6.2·§6.3 · PROJECT_RULES §6 — 타임프로그램 관리는 ADMIN 전용, 변경은 감사 대상. */
@Injectable()
export class TimeProgramsService {
  async list(): Promise<unknown> {
    return listTimePrograms(tpExecutor);
  }

  /** 프로그램 + 슬롯 + 매핑 그룹을 함께 반환. */
  async getDetail(id: string): Promise<unknown> {
    const program = await getTimeProgramById(tpExecutor, id);
    if (!program) throw new NotFoundException(`time program not found: ${id}`);
    const [slots, groups] = await Promise.all([
      listTimeProgramSlots(tpExecutor, id),
      listTimeProgramGroups(tpExecutor, id),
    ]);
    return { ...program, slots, groups };
  }

  async create(body: CreateTimeProgramRequest, auth: AuthContext): Promise<unknown> {
    if (!Number.isInteger(body.programNo) || body.programNo < 1 || body.programNo > 300) {
      throw new BadRequestException(`programNo must be an integer 1–300: ${body.programNo}`);
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length === 0) throw new BadRequestException("name is required");

    // 업무 변경(createTimeProgram)과 insertAuditLog를 같은 트랜잭션으로 묶는다 — 예전엔
    // 별도 호출이라 audit insert가 실패해도 생성만 남을 수 있었다(코드 리뷰 P1 #3).
    return withTransaction(async (client) => {
      let program;
      try {
        program = await createTimeProgram(client, {
          programNo: body.programNo,
          name,
          createdBy: auth.userId,
        });
      } catch (err) {
        if (pgCode(err) === PG_UNIQUE_VIOLATION) {
          throw new ConflictException(`program_no already exists: ${body.programNo}`);
        }
        throw err;
      }
      await this.audit(
        client,
        auth,
        "CREATE_TIME_PROGRAM",
        program.id,
        `time program #${program.programNo} '${program.name}' created`,
      );
      return program;
    });
  }

  async setEnabled(id: string, enabled: boolean, auth: AuthContext): Promise<unknown> {
    return withTransaction(async (client) => {
      const program = await setTimeProgramEnabled(client, id, enabled);
      if (!program) throw new NotFoundException(`time program not found: ${id}`);
      await this.audit(
        client,
        auth,
        enabled ? "ENABLE_TIME_PROGRAM" : "DISABLE_TIME_PROGRAM",
        program.id,
        `time program #${program.programNo} ${enabled ? "enabled" : "disabled"}`,
      );
      return program;
    });
  }

  async remove(id: string, auth: AuthContext): Promise<unknown> {
    return withTransaction(async (client) => {
      const deleted = await deleteTimeProgram(client, id);
      if (!deleted) throw new NotFoundException(`time program not found: ${id}`);
      await this.audit(client, auth, "DELETE_TIME_PROGRAM", id, `time program ${id} deleted`);
      return { deleted: true };
    });
  }

  async addSlot(id: string, body: AddSlotRequest, auth: AuthContext): Promise<unknown> {
    await this.ensureProgram(id);
    const isHoliday = body.isHoliday === true;
    let dayOfWeek: number | null;
    if (isHoliday) {
      dayOfWeek = null;
    } else {
      if (!Number.isInteger(body.dayOfWeek) || (body.dayOfWeek as number) < 0 || (body.dayOfWeek as number) > 6) {
        throw new BadRequestException("dayOfWeek must be 0–6 (0=Sun) when isHoliday is not true");
      }
      dayOfWeek = body.dayOfWeek as number;
    }
    if (typeof body.atTime !== "string" || !TIME_RE.test(body.atTime)) {
      throw new BadRequestException(`atTime must be HH:MM or HH:MM:SS: ${body.atTime}`);
    }
    if (typeof body.powerOn !== "boolean") {
      throw new BadRequestException("powerOn must be a boolean");
    }
    return withTransaction(async (client) => {
      const slot = await addTimeProgramSlot(client, {
        timeProgramId: id,
        dayOfWeek,
        isHoliday,
        atTime: body.atTime,
        powerOn: body.powerOn,
      });
      await this.audit(
        client,
        auth,
        "ADD_TIME_PROGRAM_SLOT",
        id,
        `slot ${isHoliday ? "holiday" : `dow=${dayOfWeek}`} @${body.atTime} → ${body.powerOn ? "ON" : "OFF"}`,
      );
      return slot;
    });
  }

  async removeSlot(id: string, slotId: string, auth: AuthContext): Promise<unknown> {
    return withTransaction(async (client) => {
      const removed = await deleteTimeProgramSlot(client, id, slotId);
      if (!removed) throw new NotFoundException(`slot not found: ${slotId}`);
      await this.audit(client, auth, "DELETE_TIME_PROGRAM_SLOT", id, `slot ${slotId} deleted`);
      return { deleted: true };
    });
  }

  /** 스케줄 등록: 프로그램 ↔ Device_Group 매핑. */
  async mapGroup(id: string, groupId: string, auth: AuthContext): Promise<unknown> {
    await this.ensureProgram(id);
    if (typeof groupId !== "string" || groupId.length === 0) {
      throw new BadRequestException("groupId is required");
    }
    return withTransaction(async (client) => {
      try {
        await mapTimeProgramGroup(client, id, groupId);
      } catch (err) {
        const code = pgCode(err);
        if (code === PG_UNIQUE_VIOLATION) {
          throw new ConflictException(`group already mapped: ${groupId}`);
        }
        if (code === PG_FK_VIOLATION) {
          throw new BadRequestException(`group not found: ${groupId}`);
        }
        throw err;
      }
      await this.audit(client, auth, "MAP_TIME_PROGRAM_GROUP", id, `group ${groupId} mapped`);
      return { mapped: true };
    });
  }

  async unmapGroup(id: string, groupId: string, auth: AuthContext): Promise<unknown> {
    return withTransaction(async (client) => {
      const removed = await unmapTimeProgramGroup(client, id, groupId);
      if (!removed) throw new NotFoundException(`mapping not found: program ${id} / group ${groupId}`);
      await this.audit(client, auth, "UNMAP_TIME_PROGRAM_GROUP", id, `group ${groupId} unmapped`);
      return { unmapped: true };
    });
  }

  private async ensureProgram(id: string): Promise<void> {
    const program = await getTimeProgramById(tpExecutor, id);
    if (!program) throw new NotFoundException(`time program not found: ${id}`);
  }

  private async audit(
    db: QueryExecutor,
    auth: AuthContext,
    command: string,
    targetId: string,
    reason: string,
  ): Promise<void> {
    await insertAuditLog(db, {
      actorType: "ADMIN",
      actorId: auth.userId,
      targetType: "TIME_PROGRAM",
      targetId,
      command,
      reason,
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
    });
  }
}
