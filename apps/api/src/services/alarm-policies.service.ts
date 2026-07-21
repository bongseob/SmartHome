import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AlarmTier, Severity, TargetType } from "@smarthome/contracts";
import type { AuthContext } from "@smarthome/auth";
import {
  createAlarmPolicy,
  insertAuditLog,
  listAlarmPolicies,
  query,
  setAlarmPolicyEnabled,
  updateAlarmPolicyCameraLink,
  withTransaction,
  VALID_THRESHOLD_OPERATORS,
} from "@smarthome/db";

const policyExecutor = { query };

export interface CreateAlarmPolicyRequest {
  name: string;
  tier: AlarmTier;
  targetType: TargetType;
  targetId?: string;
  metric?: string;
  operator?: string;
  thresholdValue?: number;
  durationSec?: number;
  severity: Severity;
  /** 카메라 연동(옵션, §5-cam) — 알람 발생 시 자동으로 이 카메라를 프리셋 위치로 이동시킨다. */
  linkedCameraId?: string | null;
  autoGotoPresetId?: string | null;
}

export interface SetAlarmPolicyCameraLinkRequest {
  linkedCameraId?: string | null;
  autoGotoPresetId?: string | null;
}

@Injectable()
export class AlarmPoliciesService {
  async list(): Promise<unknown> {
    return listAlarmPolicies(policyExecutor);
  }

  // 업무 변경과 insertAuditLog를 같은 트랜잭션으로 묶는다 — 예전엔 별도 호출이라 audit
  // insert가 실패해도 변경만 남을 수 있었다(코드 리뷰 P1 #3).
  async create(body: CreateAlarmPolicyRequest, auth: AuthContext): Promise<unknown> {
    // 예전엔 TypeScript interface 타입만 있고 런타임 검증이 없어서, 잘못된 enum 값이
    // alarm_tier/target_type/severity 같은 DB 컬럼에 그대로 흘러들어가 400이 아니라
    // DB 제약 위반 500으로 터졌다(코드 리뷰 P2 #14). 저장 전에 계약(zod enum)으로 검증한다.
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new BadRequestException("name은 필수입니다.");

    const tier = AlarmTier.safeParse(body.tier);
    if (!tier.success) {
      throw new BadRequestException(`tier는 ${AlarmTier.options.join(", ")} 중 하나여야 합니다.`);
    }
    const targetType = TargetType.safeParse(body.targetType);
    if (!targetType.success) {
      throw new BadRequestException(`targetType은 ${TargetType.options.join(", ")} 중 하나여야 합니다.`);
    }
    const severity = Severity.safeParse(body.severity);
    if (!severity.success) {
      throw new BadRequestException(`severity는 ${Severity.options.join(", ")} 중 하나여야 합니다.`);
    }
    if (body.operator !== undefined && !VALID_THRESHOLD_OPERATORS.includes(body.operator)) {
      throw new BadRequestException(`operator는 ${VALID_THRESHOLD_OPERATORS.join(", ")} 중 하나여야 합니다.`);
    }
    if (body.durationSec !== undefined && (!Number.isInteger(body.durationSec) || body.durationSec < 0)) {
      throw new BadRequestException("durationSec은 0 이상의 정수여야 합니다.");
    }
    if (body.thresholdValue !== undefined && !Number.isFinite(body.thresholdValue)) {
      throw new BadRequestException("thresholdValue는 유한한 숫자여야 합니다.");
    }

    return withTransaction(async (client) => {
      const policy = await createAlarmPolicy(client, {
        name: body.name,
        tier: body.tier,
        targetType: body.targetType,
        targetId: body.targetId ?? null,
        metric: body.metric ?? null,
        operator: body.operator ?? null,
        thresholdValue: body.thresholdValue ?? null,
        durationSec: body.durationSec ?? null,
        severity: body.severity,
        createdBy: auth.userId,
        linkedCameraId: body.linkedCameraId ?? null,
        autoGotoPresetId: body.autoGotoPresetId ?? null,
      });
      // 정책 변경은 관리자 설정 변경(§6 "권한 변경·...·스케줄러 변경"과 동일 성격) — 감사 대상.
      await insertAuditLog(client, {
        actorType: "ADMIN",
        actorId: auth.userId,
        targetType: "ALARM_POLICY",
        targetId: policy.id,
        command: "CREATE_ALARM_POLICY",
        reason: `policy '${policy.name}' created`,
        executionStatus: "SUCCEEDED",
        mqttReasonCode: null,
        sessionId: null,
        commandId: null,
      });
      return policy;
    });
  }

  async setEnabled(id: string, enabled: boolean, auth: AuthContext): Promise<unknown> {
    return withTransaction(async (client) => {
      const policy = await setAlarmPolicyEnabled(client, id, enabled);
      if (!policy) {
        throw new NotFoundException(`alarm policy not found: ${id}`);
      }
      await insertAuditLog(client, {
        actorType: "ADMIN",
        actorId: auth.userId,
        targetType: "ALARM_POLICY",
        targetId: policy.id,
        command: enabled ? "ENABLE_ALARM_POLICY" : "DISABLE_ALARM_POLICY",
        reason: `policy '${policy.name}' ${enabled ? "enabled" : "disabled"}`,
        executionStatus: "SUCCEEDED",
        mqttReasonCode: null,
        sessionId: null,
        commandId: null,
      });
      return policy;
    });
  }

  /** 카메라 연동 설정/해제(§5-cam) — null을 주면 해당 필드를 해제한다. */
  async setCameraLink(id: string, body: SetAlarmPolicyCameraLinkRequest, auth: AuthContext): Promise<unknown> {
    return withTransaction(async (client) => {
      const policy = await updateAlarmPolicyCameraLink(client, id, body);
      if (!policy) {
        throw new NotFoundException(`alarm policy not found: ${id}`);
      }
      await insertAuditLog(client, {
        actorType: "ADMIN",
        actorId: auth.userId,
        targetType: "ALARM_POLICY",
        targetId: policy.id,
        command: "ALARM_POLICY_CAMERA_LINK",
        reason: `linkedCameraId → '${policy.linkedCameraId ?? "null"}', autoGotoPresetId → '${policy.autoGotoPresetId ?? "null"}'`,
        executionStatus: "SUCCEEDED",
        mqttReasonCode: null,
        sessionId: null,
        commandId: null,
      });
      return policy;
    });
  }
}
