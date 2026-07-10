import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { isAdmin } from "@smarthome/auth";
import {
  DeviceConnectionConfig,
  type DeviceConnectionProtocol,
  InvalidTopicSegmentError,
  SEGMENT_PATTERN,
  buildDeviceBase,
} from "@smarthome/contracts";
import type { DeviceCategory } from "@smarthome/contracts";
import {
  createDevice,
  decommissionDevice,
  getAreaSlugPath,
  getDeviceHistory,
  getDeviceState,
  insertAuditLog,
  listDevices,
  query,
  updateDevice,
  updateDeviceConnection,
  withTransaction,
} from "@smarthome/db";

const deviceExecutor = { query };

export interface SetDeviceConnectionRequest {
  /** null이면 설정 해제(레거시/직결 MQTT 기기로 되돌림). */
  protocol: string | null;
  config?: unknown;
}

export interface CreateDeviceRequest {
  code: string;
  name: string;
  category: string;
  deviceType?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  firmwareVersion?: string | null;
  areaId: string;
  gatewayId?: string | null;
}

export interface UpdateDeviceRequest {
  name?: string;
  deviceType?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  firmwareVersion?: string | null;
  gatewayId?: string | null;
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

    return withTransaction(async (client) => {
      const before = await getDeviceState(client, id);
      if (!before) {
        throw new NotFoundException(`device not found: ${id}`);
      }
      if (before.lifecycleStatus === "DECOMMISSIONED") {
        throw new ConflictException("decommissioned device cannot be changed");
      }
      const updated = await updateDeviceConnection(client, id, protocol, config);
      if (!updated) {
        throw new NotFoundException(`device not found: ${id}`);
      }

      await insertAuditLog(client, {
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
    });
  }

  /**
   * 기기 생성(ADMIN 전용). mqtt_topic은 buildDeviceBase()로 자동 생성 — 클라이언트가 보낸
   * 세그먼트를 신뢰하지 않는다. code 중복(23505)은 BadRequestException으로 변환.
   */
  async create(body: CreateDeviceRequest, auth: AuthContext): Promise<unknown> {
    // code 필수 + 패턴 검증
    if (!body.code?.trim()) {
      throw new BadRequestException("code는 필수입니다.");
    }
    if (!SEGMENT_PATTERN.test(body.code)) {
      throw new BadRequestException(
        "code는 소문자 영숫자 및 하이픈만 가능합니다 (예: living-light-01).",
      );
    }
    if (!body.name?.trim()) {
      throw new BadRequestException("name은 필수입니다.");
    }

    // category 검증 — CAMERA는 이 폼 범위 밖(별도 온보딩 필요)
    const validCategories: DeviceCategory[] = ["DEVICE", "SENSOR", "GATEWAY"];
    if (!validCategories.includes(body.category as DeviceCategory)) {
      throw new BadRequestException(
        `category는 ${validCategories.join(", ")} 중 하나여야 합니다 (CAMERA는 별도 등록).`,
      );
    }

    return withTransaction(async (client) => {
      const slugPath = await getAreaSlugPath(client, body.areaId);
      if (!slugPath) {
        throw new NotFoundException(`area not found: ${body.areaId}`);
      }

      let mqttTopic: string;
      try {
        mqttTopic = buildDeviceBase({
          site: slugPath.siteSlug,
          building: slugPath.buildingSlug,
          floor: slugPath.floorSlug,
          area: slugPath.areaSlug,
          device: body.code,
        });
      } catch (e) {
        if (e instanceof InvalidTopicSegmentError) {
          throw new BadRequestException(`invalid topic segment: ${e.field}='${e.value}'`);
        }
        throw e;
      }

      let created;
      try {
        created = await createDevice(client, {
          code: body.code,
          name: body.name.trim(),
          category: body.category as DeviceCategory,
          deviceType: body.deviceType ?? null,
          manufacturer: body.manufacturer ?? null,
          model: body.model ?? null,
          firmwareVersion: body.firmwareVersion ?? null,
          mqttTopic,
          areaId: body.areaId,
          gatewayId: body.gatewayId ?? null,
        });
      } catch (e) {
        if ((e as { code?: string }).code === "23505") {
          throw new BadRequestException(`code '${body.code}' 또는 mqtt_topic이 이미 존재합니다.`);
        }
        throw e;
      }

      await insertAuditLog(client, {
      actorType: "ADMIN",
      actorId: auth.userId,
      targetType: "DEVICE",
      targetId: created.id,
      command: "DEVICE_CREATE",
      reason: `device '${created.code}' created (category=${created.category}, mqtt_topic=${created.mqttTopic})`,
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
      });
      return created;
    });
  }

  /**
   * 기기 기본 필드 수정(ADMIN 전용). area/code/mqtt_topic은 불변.
   */
  async update(id: string, body: UpdateDeviceRequest, auth: AuthContext): Promise<unknown> {
    if (body.name !== undefined && !body.name.trim()) {
      throw new BadRequestException("name은 비워둘 수 없습니다.");
    }
    return withTransaction(async (client) => {
      const before = await getDeviceState(client, id);
      if (!before) {
        throw new NotFoundException(`device not found: ${id}`);
      }
      if (before.lifecycleStatus === "DECOMMISSIONED") {
        throw new ConflictException("decommissioned device cannot be changed");
      }

      const normalizedName = body.name?.trim();
      const updated = await updateDevice(client, id, {
        name: normalizedName,
        deviceType: body.deviceType,
        manufacturer: body.manufacturer,
        model: body.model,
        firmwareVersion: body.firmwareVersion,
        gatewayId: body.gatewayId,
      });
      if (!updated) {
        throw new NotFoundException(`device not found: ${id}`);
      }

      const changes: string[] = [];
      if (normalizedName !== undefined && normalizedName !== before.name) {
        changes.push(`name '${before.name}' → '${normalizedName}'`);
      }
      if (body.deviceType !== undefined && body.deviceType !== before.deviceType) {
        changes.push(`deviceType '${before.deviceType ?? "null"}' → '${body.deviceType ?? "null"}'`);
      }
      if (body.manufacturer !== undefined && body.manufacturer !== before.manufacturer) {
        changes.push(`manufacturer '${before.manufacturer ?? "null"}' → '${body.manufacturer ?? "null"}'`);
      }
      if (body.model !== undefined && body.model !== before.model) {
        changes.push(`model '${before.model ?? "null"}' → '${body.model ?? "null"}'`);
      }
      if (body.firmwareVersion !== undefined && body.firmwareVersion !== before.firmwareVersion) {
        changes.push(
          `firmwareVersion '${before.firmwareVersion ?? "null"}' → '${body.firmwareVersion ?? "null"}'`,
        );
      }
      if (body.gatewayId !== undefined && body.gatewayId !== before.gatewayId) {
        changes.push(`gatewayId '${before.gatewayId ?? "null"}' → '${body.gatewayId ?? "null"}'`);
      }

      await insertAuditLog(client, {
      actorType: "ADMIN",
      actorId: auth.userId,
      targetType: "DEVICE",
      targetId: id,
      command: "DEVICE_UPDATE",
      reason: changes.length > 0 ? changes.join(", ") : "no changes",
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
      });
      return updated;
    });
  }

  /**
   * 기기 폐기(소프트 전이, ADMIN 전용). lifecycle_status → DECOMMISSIONED.
   * telemetry/command/audit 이력은 그대로 보존된다.
   */
  async decommission(id: string, auth: AuthContext): Promise<unknown> {
    return withTransaction(async (client) => {
      const before = await getDeviceState(client, id);
      if (!before) {
        throw new NotFoundException(`device not found: ${id}`);
      }
      if (before.lifecycleStatus === "DECOMMISSIONED") {
        throw new ConflictException("device is already decommissioned");
      }

      const updated = await decommissionDevice(client, id);
      if (!updated) {
        throw new NotFoundException(`device not found: ${id}`);
      }

      await insertAuditLog(client, {
      actorType: "ADMIN",
      actorId: auth.userId,
      targetType: "DEVICE",
      targetId: id,
      command: "DEVICE_DECOMMISSION",
      reason: `lifecycle ${before.lifecycleStatus} → DECOMMISSIONED`,
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
      });
      return updated;
    });
  }
}
