import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { isAdmin } from "@smarthome/auth";
import { HitlDecision, RecommendationType, type RecommendationStatus } from "@smarthome/contracts";
import {
  claimRecommendationForDispatch,
  getDeviceState,
  getRecommendation,
  insertAuditLog,
  listRecommendations,
  markRecommendationDispatchFailed,
  markRecommendationExecuted,
  query,
  recordHitlDecisionInTx,
  withTransaction,
  createRecommendation as dbCreateRecommendation,
} from "@smarthome/db";
import { assertDeviceAccess } from "../auth/device-access.guard.js";
import { CommandsService } from "./commands.service.js";

const dbExecutor = { query };

/**
 * Confidence 임계치(2026-07-14 사용자 결정, PROJECT_RULES §9) — 이 미만이면 무조건 HITL 승인 필요.
 * 고위험 장치가 아니어도 이 값 미만이면 승인을 거친다.
 */
const CONFIDENCE_THRESHOLD = 0.8;

export interface CreateRecommendationRequest {
  type: string;
  /** 이번 라운드는 DEVICE 타깃만 지원한다 — 아래 "왜 DEVICE만인지" 참고. */
  targetType: string;
  targetId: string;
  proposedCommand: string;
  proposedPayload?: unknown;
  confidenceScore: number;
  modelVersion?: string | null;
}

export interface DecisionRequest {
  decision: string;
  reason?: string | null;
}

@Injectable()
export class RecommendationsService {
  constructor(private readonly commands: CommandsService) {}

  /**
   * AI 추천 생성 + 게이트(SRS 3.5, PROJECT_RULES §9).
   *
   * 이번 라운드는 안전 인프라(저장·게이트·승인/거절·감사·학습데이터)까지만 구축한다 — 실제
   * 이상행동 감지·에너지 절감·외출/취침 판단·위험예측 모델(ML/휴리스틱)은 범위 밖이라, 이
   * 엔드포인트를 ADMIN이 테스트/데모용으로 직접 호출해 추천을 만든다(2026-07-14 사용자 결정).
   *
   * targetType은 DEVICE만 허용한다 — ai_recommendation.command_id가 단일 컬럼이라 GROUP/AREA
   * 타깃의 다중 명령 fan-out(스케줄러의 schedule_run처럼 명령마다 별도 행이 필요)을 이 스키마로
   * 깔끔히 표현할 수 없다("전체 조명 제어" 같은 GROUP 대상은 후속 과제로 남김, 부록 A.2 성격의
   * 미정 사항). 고위험 장치도 같은 이유로 "이미 모델링된 것만 게이트": 메인 차단기 성격의
   * 감시장비(device_role=MONITORING_EQUIPMENT)만 게이트하고, 도어락/가스 차단은 이 시스템에
   * 아직 device_type으로 없어 게이트 대상에서 제외한다(2026-07-14 사용자 결정).
   */
  async create(body: CreateRecommendationRequest, auth: AuthContext): Promise<unknown> {
    const type = RecommendationType.safeParse(body.type);
    if (!type.success) {
      throw new BadRequestException(`type은 ${RecommendationType.options.join(", ")} 중 하나여야 합니다.`);
    }
    if (body.targetType !== "DEVICE") {
      throw new BadRequestException(
        "targetType은 DEVICE만 지원합니다(GROUP/AREA 다중 명령 fan-out은 후속 과제).",
      );
    }
    if (!body.targetId?.trim()) {
      throw new BadRequestException("targetId는 필수입니다.");
    }
    if (!body.proposedCommand?.trim()) {
      throw new BadRequestException("proposedCommand는 필수입니다.");
    }
    if (
      typeof body.confidenceScore !== "number" ||
      Number.isNaN(body.confidenceScore) ||
      body.confidenceScore < 0 ||
      body.confidenceScore > 1
    ) {
      throw new BadRequestException("confidenceScore는 0~1 사이의 숫자여야 합니다.");
    }

    const device = await getDeviceState(dbExecutor, body.targetId);
    if (!device) {
      throw new NotFoundException(`device not found: ${body.targetId}`);
    }
    if (device.lifecycleStatus === "DECOMMISSIONED") {
      throw new ConflictException("decommissioned device는 추천 대상이 될 수 없습니다.");
    }

    const isHighRisk = device.deviceRole === "MONITORING_EQUIPMENT";
    const requiresHitl = body.confidenceScore < CONFIDENCE_THRESHOLD || isHighRisk;

    if (!requiresHitl) {
      // confidence≥임계치 + 비고위험 — 승인 없이 즉시 실행(SRS 3.5 "임계치 이하일 경우에만" 승인 필요).
      // 먼저 추천 레코드+감사를 저장한 뒤 발행한다(코드 리뷰 P2-1) — 예전엔 발행부터 하고 레코드를
      // 나중에 저장해서, 저장/감사 단계에서 DB 오류가 나면 이미 실행된 제어가 추천 레코드도
      // 감사 이력도 남기지 못했다. status="APPROVED"는 사람의 승인이 아니라 "정책상 즉시 실행
      // 확정"을 의미하며, decide()의 사람 승인 경로와 동일하게 dispatchAndFinalize가 그대로
      // APPROVED→EXECUTED/DISPATCH_FAILED 전이를 재사용한다(새 상태를 따로 만들지 않음).
      const recommendation = await dbCreateRecommendation(dbExecutor, {
        type: type.data,
        targetType: "DEVICE",
        targetId: device.id,
        proposedCommand: body.proposedCommand,
        proposedPayload: body.proposedPayload,
        confidenceScore: body.confidenceScore,
        requiresHitl: false,
        status: "APPROVED",
        modelVersion: body.modelVersion ?? null,
      });
      await insertAuditLog(dbExecutor, {
        actorType: "AI",
        actorId: null,
        targetType: "AI_RECOMMENDATION",
        targetId: recommendation.id,
        command: "AI_RECOMMENDATION_AUTO_EXECUTE",
        reason: `confidence=${body.confidenceScore} threshold=${CONFIDENCE_THRESHOLD} highRisk=false triggeredBy=${auth.userId}`,
        executionStatus: "SUCCEEDED",
        mqttReasonCode: null,
        sessionId: null,
        commandId: null,
      });
      return this.dispatchAndFinalize(recommendation.id, device.id, body.proposedCommand, body.proposedPayload);
    }

    // 승인 필요 — 실행하지 않고 대기열에 넣는다.
    const recommendation = await dbCreateRecommendation(dbExecutor, {
      type: type.data,
      targetType: "DEVICE",
      targetId: device.id,
      proposedCommand: body.proposedCommand,
      proposedPayload: body.proposedPayload,
      confidenceScore: body.confidenceScore,
      requiresHitl: true,
      status: "PENDING_APPROVAL",
      modelVersion: body.modelVersion ?? null,
    });
    await insertAuditLog(dbExecutor, {
      actorType: "AI",
      actorId: null,
      targetType: "AI_RECOMMENDATION",
      targetId: recommendation.id,
      command: "AI_RECOMMENDATION_CREATE",
      reason: `confidence=${body.confidenceScore} threshold=${CONFIDENCE_THRESHOLD} highRisk=${isHighRisk} triggeredBy=${auth.userId}`,
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
    });
    return recommendation;
  }

  async list(status: string | undefined, auth: AuthContext): Promise<unknown> {
    // area 제한 사용자는 자기 권한 범위(device 단독 권한 또는 area 권한)의 추천만 본다
    // (코드 리뷰 P1 #2). ADMIN은 전체를 본다.
    const userId = isAdmin(auth) ? null : auth.userId;
    return listRecommendations(dbExecutor, {
      ...(status ? { status: status as RecommendationStatus } : {}),
      userId,
    });
  }

  async get(id: string, auth: AuthContext): Promise<unknown> {
    const recommendation = await getRecommendation(dbExecutor, id);
    if (!recommendation) {
      throw new NotFoundException(`recommendation not found: ${id}`);
    }
    await assertDeviceAccess(auth, recommendation.targetId, "VIEW");
    return recommendation;
  }

  /**
   * Approve/Reject(HITL 승인자, SRS 3.5). Reject는 실행하지 않고 끝. Approve는 hitl_decision
   * 기록 직후 실제 제어를 발행하고(actorType=AI), 성공하면 EXECUTED로 마무리한다.
   */
  async decide(id: string, body: DecisionRequest, auth: AuthContext): Promise<unknown> {
    const decision = HitlDecision.safeParse(body.decision);
    if (!decision.success) {
      throw new BadRequestException(`decision은 ${HitlDecision.options.join(", ")} 중 하나여야 합니다.`);
    }

    // 승인/거절 트랜잭션을 시작하기 전에 대상 device 제어 권한을 확인한다(코드 리뷰 P1 #2 —
    // 전에는 area 제한 승인자가 다른 area 기기의 AI 추천을 승인해 그 기기에 명령을 발행할 수
    // 있었다). 트랜잭션 이후에 검사하면 이미 APPROVED로 커밋된 뒤라 되돌리기 번거로우므로
    // 여기서 먼저 막는다.
    const target = await getRecommendation(dbExecutor, id);
    if (!target) {
      throw new NotFoundException(`recommendation not found: ${id}`);
    }
    await assertDeviceAccess(auth, target.targetId, "CONTROL");

    const updated = await withTransaction((client) =>
      recordHitlDecisionInTx(client, {
        recommendationId: id,
        approverId: auth.userId,
        actorType: isAdmin(auth) ? "ADMIN" : "USER",
        decision: decision.data,
        reason: body.reason ?? null,
      }),
    );

    if (decision.data === "REJECT") {
      return updated;
    }

    // APPROVE — 실제 제어 발행. 승인 트랜잭션과는 별도(네트워크 I/O인 MQTT 발행을 DB 트랜잭션
    // 안에 넣지 않는다 — scheduler/gateway와 동일한 원칙). 여기서 던지면 예전엔 APPROVED에
    // 영구히 멈춰 재승인도 재시도도 못 했다(코드 리뷰 P1 #4) — 실패를 DISPATCH_FAILED로
    // 명시적으로 남기고 운영자가 retryDispatch()로 재시도할 수 있게 한다.
    return this.dispatchAndFinalize(id, updated.targetId, updated.proposedCommand, updated.proposedPayload);
  }

  /**
   * 운영자가 DISPATCH_FAILED 추천을 다시 발행 시도한다(코드 리뷰 P1 #4). 승인 자체를 다시
   * 거치지 않는다 — 이미 승인된 제어 내용을 그대로 재발행할 뿐이라 CONTROL 권한만 다시 확인한다.
   *
   * claimRecommendationForDispatch로 DISPATCH_FAILED→DISPATCHING을 원자적으로 claim한 뒤에만
   * 실제 발행을 진행한다(코드 리뷰 P1-4) — 예전엔 상태 확인(check)과 발행(act) 사이에 원자성이
   * 없어, 동시에 두 재시도 요청이 들어오면 둘 다 통과해 서로 다른 commandId로 같은 제어를
   * 중복 발행할 수 있었다.
   */
  async retryDispatch(id: string, auth: AuthContext): Promise<unknown> {
    const recommendation = await getRecommendation(dbExecutor, id);
    if (!recommendation) {
      throw new NotFoundException(`recommendation not found: ${id}`);
    }
    await assertDeviceAccess(auth, recommendation.targetId, "CONTROL");

    const claimed = await claimRecommendationForDispatch(dbExecutor, id);
    if (!claimed) {
      throw new ConflictException(
        `DISPATCH_FAILED 상태에서만 재시도할 수 있습니다(현재: ${recommendation.status}, 이미 다른 요청이 재시도 중일 수 있습니다).`,
      );
    }
    return this.dispatchAndFinalize(
      id,
      claimed.targetId,
      claimed.proposedCommand,
      claimed.proposedPayload,
    );
  }

  private async dispatchAndFinalize(
    id: string,
    targetId: string,
    proposedCommand: string,
    proposedPayload: unknown,
  ): Promise<unknown> {
    try {
      const dispatch = await this.commands.dispatchAsAi(
        targetId,
        proposedCommand,
        proposedPayload as Record<string, unknown> | undefined,
      );
      return await markRecommendationExecuted(dbExecutor, id, dispatch.commandId);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await markRecommendationDispatchFailed(dbExecutor, id, `dispatch failed: ${reason}`);
      throw new BadRequestException(`제어 발행 실패 — 추천은 DISPATCH_FAILED로 남았습니다: ${reason}`);
    }
  }
}
