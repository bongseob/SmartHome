import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { isAdmin } from "@smarthome/auth";
import { HitlDecision, RecommendationType, type RecommendationStatus } from "@smarthome/contracts";
import {
  getDeviceState,
  getRecommendation,
  insertAuditLog,
  listRecommendations,
  markRecommendationExecuted,
  query,
  recordHitlDecisionInTx,
  withTransaction,
  createRecommendation as dbCreateRecommendation,
} from "@smarthome/db";
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
      const dispatch = await this.commands.dispatchAsAi(
        device.id,
        body.proposedCommand,
        body.proposedPayload as Record<string, unknown> | undefined,
      );
      const recommendation = await dbCreateRecommendation(dbExecutor, {
        type: type.data,
        targetType: "DEVICE",
        targetId: device.id,
        proposedCommand: body.proposedCommand,
        proposedPayload: body.proposedPayload,
        confidenceScore: body.confidenceScore,
        requiresHitl: false,
        status: "EXECUTED",
        commandId: dispatch.commandId,
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
      return recommendation;
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

  async list(status?: string): Promise<unknown> {
    return listRecommendations(dbExecutor, status ? { status: status as RecommendationStatus } : {});
  }

  async get(id: string): Promise<unknown> {
    const recommendation = await getRecommendation(dbExecutor, id);
    if (!recommendation) {
      throw new NotFoundException(`recommendation not found: ${id}`);
    }
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
    // 안에 넣지 않는다 — scheduler/gateway와 동일한 원칙).
    const dispatch = await this.commands.dispatchAsAi(
      updated.targetId,
      updated.proposedCommand,
      updated.proposedPayload as Record<string, unknown> | undefined,
    );
    return markRecommendationExecuted(dbExecutor, id, dispatch.commandId);
  }
}
