import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { CurrentAuth, Roles } from "../auth/auth.decorators.js";
import {
  RecommendationsService,
  type CreateRecommendationRequest,
  type DecisionRequest,
} from "../services/recommendations.service.js";

@Controller("api/v1/recommendations")
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  /** AI 추천 생성 — ADMIN 전용. 실제 ML 모델은 범위 밖이라 테스트/데모용 직접 호출로 대체(2026-07-14 결정). */
  @Roles("ADMIN")
  @Post()
  create(@Body() body: CreateRecommendationRequest, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.recommendations.create(body, auth);
  }

  @Roles("ADMIN", "HITL_APPROVER")
  @Get()
  list(@Query("status") status: string | undefined, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.recommendations.list(status, auth);
  }

  @Roles("ADMIN", "HITL_APPROVER")
  @Get(":id")
  get(@Param("id") id: string, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.recommendations.get(id, auth);
  }

  /** Approve/Reject — HITL 승인자(SRS 2.4). */
  @Roles("ADMIN", "HITL_APPROVER")
  @Post(":id/decision")
  decide(
    @Param("id") id: string,
    @Body() body: DecisionRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<unknown> {
    return this.recommendations.decide(id, body, auth);
  }

  /**
   * 승인은 됐지만 실제 제어 발행이 실패해 DISPATCH_FAILED로 남은 추천을 재시도한다
   * (코드 리뷰 P1 #4 — 예전엔 이 복구 경로 자체가 없었다).
   */
  @Roles("ADMIN", "HITL_APPROVER")
  @Post(":id/retry-dispatch")
  retryDispatch(@Param("id") id: string, @CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.recommendations.retryDispatch(id, auth);
  }
}
