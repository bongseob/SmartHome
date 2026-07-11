import { BadRequestException, Injectable } from "@nestjs/common";
import { listEventHistory, query } from "@smarthome/db";

const executor = { query };

const GRADES = new Set(["ALL", "INFO", "WARNING"]);
const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 200;

export interface EventHistoryQuery {
  grade?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit?: string | undefined;
}

/** addendum §8 — 장애이력 조회(읽기 전용). 등급(알림/경고/전체) + 기간 필터. */
@Injectable()
export class EventHistoryService {
  async list(q: EventHistoryQuery): Promise<unknown> {
    const grade = (q.grade ?? "ALL").toUpperCase();
    if (!GRADES.has(grade)) {
      throw new BadRequestException(`grade must be ALL, INFO, or WARNING: ${q.grade}`);
    }
    const includeInfo = grade === "ALL" || grade === "INFO";
    const includeWarning = grade === "ALL" || grade === "WARNING";

    const from = this.parseDate(q.from, "from");
    const to = this.parseDate(q.to, "to");
    if (from && to && from > to) {
      throw new BadRequestException("from must be before to");
    }

    let limit = DEFAULT_LIMIT;
    if (q.limit !== undefined) {
      const n = Number(q.limit);
      if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
        throw new BadRequestException(`limit must be an integer 1–${MAX_LIMIT}`);
      }
      limit = n;
    }

    return listEventHistory(executor, { from, to, includeInfo, includeWarning, limit });
  }

  private parseDate(value: string | undefined, field: string): Date | null {
    if (value === undefined || value === "") return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`${field} must be an ISO datetime: ${value}`);
    }
    return d;
  }
}
