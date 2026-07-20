import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { AlarmActionType, AlarmState, AlarmTier, Severity } from "@smarthome/contracts";
import { IllegalAlarmTransitionError } from "@smarthome/contracts";
import { hasAreaAccess, isAdmin, type AuthContext } from "@smarthome/auth";
import {
  AlarmNotFoundError,
  getAlarmPolicyById,
  getAlarmWithAreaScope,
  getCameraSummaryByDeviceId,
  listAlarms,
  listCamerasCoveringArea,
  query,
  recordAlarmAction,
  type AlarmWithAreaRow,
  type CameraSummary,
} from "@smarthome/db";
import { createRealtimePublisher, publishRealtimeEvent, type RealtimePublisher } from "@smarthome/realtime";

const alarmExecutor = { query };

export interface AlarmListFilterRequest {
  state?: AlarmState;
  tier?: AlarmTier;
  severity?: Severity;
  deviceId?: string;
}

export interface AlarmActionRequest {
  note?: string;
}

export interface AlarmSnoozeRequest extends AlarmActionRequest {
  minutes: number;
}

export interface AlarmNoteRequest {
  note: string;
}

@Injectable()
export class AlarmsService implements OnModuleInit, OnModuleDestroy {
  private events: RealtimePublisher | undefined;

  async onModuleInit(): Promise<void> {
    this.events = createRealtimePublisher();
    await this.events.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.events) await this.events.quit();
  }

  private assertVisible(auth: AuthContext, alarm: AlarmWithAreaRow): void {
    if (isAdmin(auth)) return;
    if (!alarm.areaTopicPrefix || !hasAreaAccess(auth, alarm.areaTopicPrefix)) {
      // 존재 자체를 노출하지 않도록 device 목록/조회와 동일하게 404로 응답한다.
      throw new NotFoundException(`alarm not found: ${alarm.id}`);
    }
  }

  async list(filter: AlarmListFilterRequest, auth: AuthContext): Promise<unknown> {
    const alarms = await listAlarms(alarmExecutor, filter);
    if (isAdmin(auth)) return alarms;
    return alarms.filter((a) => a.areaTopicPrefix !== null && hasAreaAccess(auth, a.areaTopicPrefix));
  }

  async get(id: string, auth: AuthContext): Promise<unknown> {
    const alarm = await getAlarmWithAreaScope(alarmExecutor, id);
    if (!alarm) throw new NotFoundException(`alarm not found: ${id}`);
    this.assertVisible(auth, alarm);
    return alarm;
  }

  private async ensureVisibleAndFetch(id: string, auth: AuthContext): Promise<AlarmWithAreaRow> {
    const alarm = await getAlarmWithAreaScope(alarmExecutor, id);
    if (!alarm) throw new NotFoundException(`alarm not found: ${id}`);
    this.assertVisible(auth, alarm);
    return alarm;
  }

  private async performAction(
    id: string,
    auth: AuthContext,
    actionType: AlarmActionType,
    note: string | null,
    snoozeUntil?: Date | null,
  ): Promise<unknown> {
    await this.ensureVisibleAndFetch(id, auth);
    try {
      const updated = await recordAlarmAction({
        alarmId: id,
        actorId: auth.userId,
        actorType: isAdmin(auth) ? "ADMIN" : "USER",
        actionType,
        note: note ?? null,
        snoozeUntil: snoozeUntil ?? null,
      });
      if (this.events) {
        await publishRealtimeEvent(this.events, {
          type: "alarm.updated",
          alarmId: updated.id,
          deviceId: updated.deviceId,
          state: updated.state,
          ts: Date.now(),
        });
      }
      return updated;
    } catch (err) {
      if (err instanceof AlarmNotFoundError) throw new NotFoundException(err.message);
      if (err instanceof IllegalAlarmTransitionError) throw new ConflictException(err.message);
      throw err;
    }
  }

  async ack(id: string, auth: AuthContext, body: AlarmActionRequest): Promise<unknown> {
    return this.performAction(id, auth, "ACK", body.note ?? null);
  }

  async snooze(id: string, auth: AuthContext, body: AlarmSnoozeRequest): Promise<unknown> {
    if (!body.minutes || body.minutes <= 0) {
      throw new BadRequestException("minutes must be a positive number");
    }
    const until = new Date(Date.now() + body.minutes * 60_000);
    return this.performAction(id, auth, "SNOOZE", body.note ?? null, until);
  }

  async resolve(id: string, auth: AuthContext, body: AlarmActionRequest): Promise<unknown> {
    return this.performAction(id, auth, "RESOLVE", body.note ?? null);
  }

  async note(id: string, auth: AuthContext, body: AlarmNoteRequest): Promise<unknown> {
    if (!body.note?.trim()) {
      throw new BadRequestException("note is required");
    }
    return this.performAction(id, auth, "NOTE", body.note);
  }

  /**
   * 알람 발생원을 커버하는 카메라 목록(현장 확인용, api-spec.md §4-cam `GET /alarms/:id/cameras`).
   * 두 출처를 합쳐서(중복 제거) 돌려준다:
   *   1) 발생원 Area를 화각으로 커버하는 카메라(camera_coverage)
   *   2) 정책에 명시적으로 연결된 카메라(alarm_policy.linked_camera_id) — 커버리지 매핑이
   *      안 돼 있어도 관리자가 지정한 카메라이므로 항상 포함한다.
   */
  async getCameras(id: string, auth: AuthContext): Promise<CameraSummary[]> {
    const alarm = await this.ensureVisibleAndFetch(id, auth);
    const byDeviceId = new Map<string, CameraSummary>();

    if (alarm.areaId) {
      const covering = await listCamerasCoveringArea(alarmExecutor, alarm.areaId);
      for (const camera of covering) byDeviceId.set(camera.deviceId, camera);
    }

    if (alarm.policyId) {
      const policy = await getAlarmPolicyById(alarmExecutor, alarm.policyId);
      if (policy?.linkedCameraId) {
        const linked = await getCameraSummaryByDeviceId(alarmExecutor, policy.linkedCameraId);
        if (linked) byDeviceId.set(linked.deviceId, linked);
      }
    }

    return [...byDeviceId.values()];
  }
}
