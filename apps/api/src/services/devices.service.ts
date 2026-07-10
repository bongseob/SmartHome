import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { isAdmin } from "@smarthome/auth";
import { DeviceConnectionConfig, type DeviceConnectionProtocol } from "@smarthome/contracts";
import {
  getDeviceHistory,
  getDeviceState,
  insertAuditLog,
  listDevices,
  query,
  updateDeviceConnection,
} from "@smarthome/db";

const deviceExecutor = { query };

export interface SetDeviceConnectionRequest {
  /** null이면 설정 해제(레거시/직결 MQTT 기기로 되돌림). */
  protocol: string | null;
  config?: unknown;
}

@Injectable()
export class DevicesService {
  async list(
    filter: { areaId?: string; category?: string; status?: string },
    auth: AuthContext,
  ): Promise<unknown> {
    const devices = await listDevices(deviceExecutor, filter);
    if (isAdmin(auth)) return devices;

    // 사용자의 ACL topic에서 area 프리픽스 집합 추출
    const allowedAreaPrefixes = new Set(
      auth.topics.map((t) => t.replace(/\/#$/, "")),
    );
    return devices.filter(
      (d) => d.areaTopicPrefix !== null && allowedAreaPrefixes.has(d.areaTopicPrefix),
    );
  }

  async state(id: string): Promise<unknown> {
    const device = await getDeviceState(deviceExecutor, id);
    if (!device) {
      throw new NotFoundException(`device not found: ${id}`);
    }
    return device;
  }

  async history(id: string, limit?: string): Promise<unknown> {
    const parsedLimit = limit ? Number(limit) : 20;
    const deviceHistory = await getDeviceHistory(
      deviceExecutor,
      id,
      Number.isFinite(parsedLimit) ? parsedLimit : 20,
    );
    if (!deviceHistory) {
      throw new NotFoundException(`device not found: ${id}`);
    }
    return deviceHistory;
  }

  /**
   * Device↔Gateway 연결 프로토콜/파라미터 설정(SRS 2.1.2·3.1.1, PROJECT_RULES 부록 A.1).
   * Gateway↔플랫폼 구간은 항상 MQTT — 이 값과 무관하다. ADMIN 전용, 변경은 감사 대상.
   */
  async setConnection(
    id: string,
    body: SetDeviceConnectionRequest,
    auth: AuthContext,
  ): Promise<unknown> {
    const before = await getDeviceState(deviceExecutor, id);
    if (!before) {
      throw new NotFoundException(`device not found: ${id}`);
    }

    let protocol: DeviceConnectionProtocol | null = null;
    let config: unknown = null;
    if (body.protocol !== null && body.protocol !== undefined) {
      const parsed = DeviceConnectionConfig.safeParse({
        protocol: body.protocol,
        config: body.config ?? {},
      });
      if (!parsed.success) {
        throw new BadRequestException(`invalid connection config: ${parsed.error.message}`);
      }
      protocol = parsed.data.protocol;
      config = parsed.data.config;
    }

    const updated = await updateDeviceConnection(deviceExecutor, id, protocol, config);
    if (!updated) {
      throw new NotFoundException(`device not found: ${id}`);
    }

    await insertAuditLog(deviceExecutor, {
      actorType: "ADMIN",
      actorId: auth.userId,
      targetType: "DEVICE",
      targetId: id,
      command: "DEVICE_CONNECTION_UPDATE",
      reason: `connectionProtocol ${before.connectionProtocol ?? "null"} → ${protocol ?? "null"}`,
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
    });

    return updated;
  }
}
