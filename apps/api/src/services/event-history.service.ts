import { BadRequestException, Injectable } from "@nestjs/common";
import { isAdmin, type AuthContext } from "@smarthome/auth";
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
  async list(q: EventHistoryQuery, auth: AuthContext): Promise<unknown> {
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

    // area 제한 사용자는 자기 권한 범위(device 단독 권한 또는 area 권한)의 행만 본다
    // (코드 리뷰 P1 #2). ADMIN은 전사 이력을 그대로 본다.
    const userId = isAdmin(auth) ? null : auth.userId;
    return listEventHistory(executor, { from, to, includeInfo, includeWarning, limit, userId });
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
