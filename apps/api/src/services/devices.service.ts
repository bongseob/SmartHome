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
import type { DeviceCategory, DeviceRole, LoadClass, SensorIoType, SensorSignalType } from "@smarthome/contracts";
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
  updateDeviceMonitoringFlags,
  updateDeviceSimulated,
  withTransaction,
} from "@smarthome/db";

const deviceExecutor = { query };

export interface SetDeviceConnectionRequest {
  /** null이면 설정 해제(레거시/직결 MQTT 기기로 되돌림). */
  protocol: string | null;
  config?: unknown;
}

export interface SetDeviceMonitoringRequest {
  monitoringVisible?: boolean;
  enabled?: boolean;
}

export interface SetDeviceSimulatedRequest {
  simulated: boolean;
}

export interface CreateDeviceRequest {
  code: string;
  name: string;
  category: string;
  deviceRole?: DeviceRole;
  deviceType?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  firmwareVersion?: string | null;
  areaId: string;
  gatewayId?: string | null;
  parentDeviceId?: string | null;
  sensorSignalType?: SensorSignalType | null;
  sensorIoType?: SensorIoType | null;
  channelAddress?: string | null;
  terminalBlock?: string | null;
  loadClass?: LoadClass | null;
  description?: string | null;
}

export interface UpdateDeviceRequest {
  name?: string;
  deviceType?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  firmwareVersion?: string | null;
  gatewayId?: string | null;
  parentDeviceId?: string | null;
  sensorSignalType?: SensorSignalType | null;
  sensorIoType?: SensorIoType | null;
  channelAddress?: string | null;
  terminalBlock?: string | null;
  loadClass?: LoadClass | null;
  description?: string | null;
  imageId?: string | null;
}

const DEVICE_ROLES: DeviceRole[] = ["MONITORING_EQUIPMENT", "SENSOR"];
const SENSOR_SIGNAL_TYPES: SensorSignalType[] = ["DIGITAL", "ANALOG"];
const SENSOR_IO_TYPES: SensorIoType[] = ["DI", "DO", "AI", "AO"];

function signalTypeForIo(ioType: SensorIoType | null | undefined): SensorSignalType | null {
  if (!ioType) return null;
  return ioType.startsWith("D") ? "DIGITAL" : "ANALOG";
}

function normalizeDeviceRole(role: DeviceRole | undefined, category: string): DeviceRole {
  if (role) return role;
  return category === "GATEWAY" ? "MONITORING_EQUIPMENT" : "SENSOR";
}

function validateDeviceRole(role: DeviceRole): void {
  if (!DEVICE_ROLES.includes(role)) {
    throw new BadRequestException(`deviceRole은 ${DEVICE_ROLES.join(", ")} 중 하나여야 합니다.`);
  }
}

function validateSensorMetadata(input: {
  deviceRole: DeviceRole;
  parentDeviceId?: string | null;
  sensorSignalType?: SensorSignalType | null;
  sensorIoType?: SensorIoType | null;
}): void {
  validateDeviceRole(input.deviceRole);
  if (input.deviceRole === "MONITORING_EQUIPMENT") {
    if (input.parentDeviceId) {
      throw new BadRequestException("감시장비는 상위 감시장비를 가질 수 없습니다.");
    }
    return;
  }
  if (input.sensorSignalType && !SENSOR_SIGNAL_TYPES.includes(input.sensorSignalType)) {
    throw new BadRequestException(`sensorSignalType은 ${SENSOR_SIGNAL_TYPES.join(", ")} 중 하나여야 합니다.`);
  }
  if (input.sensorIoType && !SENSOR_IO_TYPES.includes(input.sensorIoType)) {
    throw new BadRequestException(`sensorIoType은 ${SENSOR_IO_TYPES.join(", ")} 중 하나여야 합니다.`);
  }
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

  async setMonitoring(
    id: string,
    body: SetDeviceMonitoringRequest,
    auth: AuthContext,
  ): Promise<unknown> {
    const hasMonitoringVisible = body.monitoringVisible !== undefined;
    const hasEnabled = body.enabled !== undefined;
    if (!hasMonitoringVisible && !hasEnabled) {
      throw new BadRequestException("monitoringVisible 또는 enabled 중 하나는 필요합니다.");
    }
    if (hasMonitoringVisible && typeof body.monitoringVisible !== "boolean") {
      throw new BadRequestException("monitoringVisible은 boolean이어야 합니다.");
    }
    if (hasEnabled && typeof body.enabled !== "boolean") {
      throw new BadRequestException("enabled는 boolean이어야 합니다.");
    }

    return withTransaction(async (client) => {
      const before = await getDeviceState(client, id);
      if (!before) {
        throw new NotFoundException(`device not found: ${id}`);
      }
      if (before.lifecycleStatus === "DECOMMISSIONED") {
        throw new ConflictException("decommissioned device cannot be changed");
      }

      const input: SetDeviceMonitoringRequest = {};
      if (typeof body.monitoringVisible === "boolean") {
        input.monitoringVisible = body.monitoringVisible;
      }
      if (typeof body.enabled === "boolean") {
        input.enabled = body.enabled;
      }
      const updated = await updateDeviceMonitoringFlags(client, id, input);
      if (!updated) {
        throw new NotFoundException(`device not found: ${id}`);
      }

      const changes: string[] = [];
      if (hasMonitoringVisible && body.monitoringVisible !== before.monitoringVisible) {
        changes.push(`monitoringVisible ${before.monitoringVisible} → ${body.monitoringVisible}`);
      }
      if (hasEnabled && body.enabled !== before.enabled) {
        changes.push(`enabled ${before.enabled} → ${body.enabled}`);
      }

      await insertAuditLog(client, {
      actorType: "ADMIN",
      actorId: auth.userId,
      targetType: "DEVICE",
      targetId: id,
      command: "DEVICE_MONITORING_UPDATE",
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
    const deviceRole = normalizeDeviceRole(body.deviceRole, body.category);
    const sensorIoType = deviceRole === "SENSOR" ? body.sensorIoType ?? "DI" : null;
    const sensorSignalType = deviceRole === "SENSOR" ? body.sensorSignalType ?? signalTypeForIo(sensorIoType) : null;
    validateSensorMetadata(
      body.parentDeviceId !== undefined
        ? { deviceRole, parentDeviceId: body.parentDeviceId, sensorSignalType, sensorIoType }
        : { deviceRole, sensorSignalType, sensorIoType },
    );

    return withTransaction(async (client) => {
      if (body.parentDeviceId) {
        const parent = await getDeviceState(client, body.parentDeviceId);
        if (!parent) throw new NotFoundException(`parent device not found: ${body.parentDeviceId}`);
        if (parent.deviceRole !== "MONITORING_EQUIPMENT") {
          throw new BadRequestException("센서의 parentDeviceId는 감시장비여야 합니다.");
        }
      }
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
          deviceRole,
          deviceType: body.deviceType ?? null,
          manufacturer: body.manufacturer ?? null,
          model: body.model ?? null,
          firmwareVersion: body.firmwareVersion ?? null,
          mqttTopic,
          areaId: body.areaId,
          gatewayId: body.gatewayId ?? null,
          parentDeviceId: deviceRole === "SENSOR" ? body.parentDeviceId ?? null : null,
          sensorSignalType: deviceRole === "SENSOR" ? sensorSignalType : null,
          sensorIoType,
          channelAddress: deviceRole === "SENSOR" ? body.channelAddress ?? null : null,
          terminalBlock: body.terminalBlock ?? null,
          loadClass: body.loadClass ?? "NORMAL",
          description: body.description ?? null,
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
      const sensorSignalType = body.sensorSignalType ?? signalTypeForIo(body.sensorIoType);
      validateSensorMetadata(
        body.parentDeviceId !== undefined
          ? {
              deviceRole: before.deviceRole,
              parentDeviceId: body.parentDeviceId,
              sensorSignalType,
              sensorIoType: body.sensorIoType ?? null,
            }
          : {
              deviceRole: before.deviceRole,
              sensorSignalType,
              sensorIoType: body.sensorIoType ?? null,
            },
      );
      if (body.parentDeviceId) {
        const parent = await getDeviceState(client, body.parentDeviceId);
        if (!parent) throw new NotFoundException(`parent device not found: ${body.parentDeviceId}`);
        if (parent.deviceRole !== "MONITORING_EQUIPMENT") {
          throw new BadRequestException("센서의 parentDeviceId는 감시장비여야 합니다.");
        }
      }

      const normalizedName = body.name?.trim();
      const updateInput: UpdateDeviceRequest = {};
      if (normalizedName !== undefined) updateInput.name = normalizedName;
      if (body.deviceType !== undefined) updateInput.deviceType = body.deviceType;
      if (body.manufacturer !== undefined) updateInput.manufacturer = body.manufacturer;
      if (body.model !== undefined) updateInput.model = body.model;
      if (body.firmwareVersion !== undefined) updateInput.firmwareVersion = body.firmwareVersion;
      if (body.gatewayId !== undefined) updateInput.gatewayId = body.gatewayId;
      if (body.terminalBlock !== undefined) updateInput.terminalBlock = body.terminalBlock;
      if (body.loadClass !== undefined) updateInput.loadClass = body.loadClass;
      if (body.description !== undefined) updateInput.description = body.description;
      if (body.imageId !== undefined) updateInput.imageId = body.imageId;
      if (before.deviceRole === "SENSOR") {
        if (body.parentDeviceId !== undefined) updateInput.parentDeviceId = body.parentDeviceId;
        // signalTypeForIo()는 sensorIoType이 없으면 undefined가 아니라 null을 돌려주므로,
        // 호출부가 sensorSignalType/sensorIoType 둘 다 안 보냈을 때도 sensorSignalType이 null로
        // 잡혀 기존 값을 지워버리지 않도록 "둘 중 하나라도 보냈을 때만" 반영한다.
        if (body.sensorSignalType !== undefined || body.sensorIoType !== undefined) {
          updateInput.sensorSignalType = sensorSignalType;
        }
        if (body.sensorIoType !== undefined) updateInput.sensorIoType = body.sensorIoType;
        if (body.channelAddress !== undefined) updateInput.channelAddress = body.channelAddress;
      }
      const updated = await updateDevice(client, id, updateInput);
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
      if (body.loadClass !== undefined && body.loadClass !== before.loadClass) {
        changes.push(`loadClass '${before.loadClass ?? "null"}' → '${body.loadClass ?? "null"}'`);
      }
      if (body.description !== undefined && body.description !== before.description) {
        changes.push(`description '${before.description ?? "null"}' → '${body.description ?? "null"}'`);
      }
      if (body.imageId !== undefined && body.imageId !== before.imageId) {
        changes.push(`imageId '${before.imageId ?? "null"}' → '${body.imageId ?? "null"}'`);
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

  /**
   * 실기기 없이 개발/시연하기 위한 시뮬레이터 응답 대상 여부 토글(§device.simulated).
   * true(기본)면 device-simulator의 MockResponder가 이 기기의 cmd에 대신 응답한다 — 실기기를
   * 연결하면 false로 바꿔 목 응답을 끈다. monitoringVisible/enabled와 달리 관제 화면 노출과는
   * 무관해 별도 엔드포인트로 둔다.
   */
  async setSimulated(id: string, body: SetDeviceSimulatedRequest, auth: AuthContext): Promise<unknown> {
    if (typeof body.simulated !== "boolean") {
      throw new BadRequestException("simulated는 boolean이어야 합니다.");
    }

    return withTransaction(async (client) => {
      const before = await getDeviceState(client, id);
      if (!before) {
        throw new NotFoundException(`device not found: ${id}`);
      }
      if (before.lifecycleStatus === "DECOMMISSIONED") {
        throw new ConflictException("decommissioned device cannot be changed");
      }

      const updated = await updateDeviceSimulated(client, id, body.simulated);
      if (!updated) {
        throw new NotFoundException(`device not found: ${id}`);
      }

      await insertAuditLog(client, {
        actorType: "ADMIN",
        actorId: auth.userId,
        targetType: "DEVICE",
        targetId: id,
        command: "DEVICE_SIMULATED_UPDATE",
        reason: `simulated ${before.simulated} → ${body.simulated}`,
        executionStatus: "SUCCEEDED",
        mqttReasonCode: null,
        sessionId: null,
        commandId: null,
      });
      return updated;
    });
  }
}
