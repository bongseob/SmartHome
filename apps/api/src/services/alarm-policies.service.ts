import { Injectable, NotFoundException } from "@nestjs/common";
import type { AlarmTier, Severity, TargetType } from "@smarthome/contracts";
import type { AuthContext } from "@smarthome/auth";
import {
  createAlarmPolicy,
  insertAuditLog,
  listAlarmPolicies,
  query,
  setAlarmPolicyEnabled,
  updateAlarmPolicyCameraLink,
  withTransaction,
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
