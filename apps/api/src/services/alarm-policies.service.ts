import { Injectable, NotFoundException } from "@nestjs/common";
import type { AlarmTier, Severity, TargetType } from "@smarthome/contracts";
import type { AuthContext } from "@smarthome/auth";
import {
  createAlarmPolicy,
  insertAuditLog,
  listAlarmPolicies,
  query,
  setAlarmPolicyEnabled,
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
}

@Injectable()
export class AlarmPoliciesService {
  async list(): Promise<unknown> {
    return listAlarmPolicies(policyExecutor);
  }

  async create(body: CreateAlarmPolicyRequest, auth: AuthContext): Promise<unknown> {
    const policy = await createAlarmPolicy(policyExecutor, {
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
    });
    // 정책 변경은 관리자 설정 변경(§6 "권한 변경·...·스케줄러 변경"과 동일 성격) — 감사 대상.
    await insertAuditLog(policyExecutor, {
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
  }

  async setEnabled(id: string, enabled: boolean, auth: AuthContext): Promise<unknown> {
    const policy = await setAlarmPolicyEnabled(policyExecutor, id, enabled);
    if (!policy) {
      throw new NotFoundException(`alarm policy not found: ${id}`);
    }
    await insertAuditLog(policyExecutor, {
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
  }
}
