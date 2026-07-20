import { describe, expect, it } from "vitest";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";
import { createAlarmPolicy, updateAlarmPolicyCameraLink } from "./alarm-repository.js";

const POLICY_ROW = {
  id: "policy-1",
  name: "거실 과열",
  tier: "REACTIVE",
  target_type: "DEVICE",
  target_id: "device-1",
  metric: "temperature",
  operator: ">",
  threshold_value: "40",
  duration_sec: 60,
  severity: "CRITICAL",
  enabled: true,
  linked_camera_id: "cam-1",
  auto_goto_preset_id: "preset-1",
};

class FakeAlarmPolicyDb implements QueryExecutor {
  readonly statements: string[] = [];
  readonly params: unknown[][] = [];

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    this.statements.push(text);
    this.params.push(values ?? []);
    return { rows: [POLICY_ROW as unknown as T], rowCount: 1 };
  }
}

describe("alarm policy 카메라 연동(§5-cam)", () => {
  it("createAlarmPolicy에 linkedCameraId/autoGotoPresetId를 실어 보낸다", async () => {
    const db = new FakeAlarmPolicyDb();
    const policy = await createAlarmPolicy(db, {
      name: "거실 과열",
      tier: "REACTIVE",
      targetType: "DEVICE",
      targetId: "device-1",
      severity: "CRITICAL",
      linkedCameraId: "cam-1",
      autoGotoPresetId: "preset-1",
    });
    expect(policy.linkedCameraId).toBe("cam-1");
    expect(policy.autoGotoPresetId).toBe("preset-1");
    expect(db.params[0]).toContain("cam-1");
    expect(db.params[0]).toContain("preset-1");
  });

  it("updateAlarmPolicyCameraLink는 지정한 필드만 SET한다", async () => {
    const db = new FakeAlarmPolicyDb();
    await updateAlarmPolicyCameraLink(db, "policy-1", { linkedCameraId: "cam-2" });
    const statement = db.statements[0];
    expect(statement).toContain("linked_camera_id = $2");
    expect(statement).not.toContain("auto_goto_preset_id =");
  });

  it("둘 다 null이면 연동을 해제한다", async () => {
    const db = new FakeAlarmPolicyDb();
    await updateAlarmPolicyCameraLink(db, "policy-1", { linkedCameraId: null, autoGotoPresetId: null });
    expect(db.params[0]).toEqual(["policy-1", null, null]);
  });
});
