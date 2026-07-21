import { Controller, Get, Query } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { CurrentAuth, Roles } from "../auth/auth.decorators.js";
import { EventHistoryService } from "../services/event-history.service.js";

/**
 * addendum §8 · SRS 2.3 — 장애이력 조회. 모니터링 담당자/사용자의 감시 화면(ADMIN 자동 허용).
 * 읽기 전용이므로 감사 로그를 남기지 않는다.
 */
@Controller("api/v1/event-history")
export class EventHistoryController {
  constructor(private readonly history: EventHistoryService) {}

  @Roles("MONITOR", "USER", "HITL_APPROVER")
  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query("grade") grade?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
  ): Promise<unknown> {
    return this.history.list({ grade, from, to, limit }, auth);
  }
}
