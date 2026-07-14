import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { actorRole, hasAccessLevel, isAdmin, type AuthContext } from "@smarthome/auth";
import {
  buildServiceStatusWildcard,
  parseDeviceBase,
  ServiceStatusPayload,
  SERVICE_NAMES,
  type ActorType,
  type Role,
  type ServiceName,
  type TargetType,
} from "@smarthome/contracts";
import { connect, type DeviceIdentity, type MqttClient } from "@smarthome/mqtt";
import { createRealtimePublisher, publishRealtimeEvent, type RealtimePublisher } from "@smarthome/realtime";
import {
  getCommandById,
  getDeviceAccessLevel,
  getDeviceState,
  getSequentialIntervalMs,
  listDevices,
  query,
} from "@smarthome/db";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
import {
  createRedisCommandClient,
  publishDeviceCommand,
  type RedisCommandClient,
} from "@smarthome/command-flow";

/**
 * 클라이언트는 대상 device의 id(또는 code)만 보낸다.
 * 발행 토픽(UNS identity)은 서버가 DB의 canonical mqtt_topic 에서 도출한다 —
 * 클라이언트가 준 토픽 세그먼트를 신뢰하면 권한 검사(target.id)와 실제 발행 대상이
 * 어긋날 수 있다(권한 우회·감사 왜곡).
 */
interface CommandTargetRequest {
  id: string;
  type?: TargetType;
}

export interface CreateCommandRequest {
  commandId?: string;
  sessionId?: string;
  actorType?: ActorType;
  actorId?: string | null;
  role?: Role;
  command: string;
  target: CommandTargetRequest;
  args?: Record<string, unknown>;
}

interface CommandResponse {
  commandId: string;
  status: string;
  published?: boolean;
}

export interface CreateGroupCommandRequest {
  sessionId?: string;
  command: string;
  target: { id: string; type?: TargetType };
  args?: Record<string, unknown>;
}

interface GroupBatchItem {
  deviceId: string;
  commandId?: string;
  status?: string;
  published?: boolean;
  error?: string;
}

interface GroupBatchResponse {
  groupId: string;
  command: string;
  intervalMs: number;
  count: number;
  results: GroupBatchItem[];
}

const commandExecutor = { query };

@Injectable()
export class CommandsService implements OnModuleInit, OnModuleDestroy {
  private mqtt: MqttClient | undefined;
  private redis: RedisCommandClient | undefined;
  private publisher: RealtimePublisher | undefined;
  // 서버 상태 위젯(web) 전용 — gateway/scheduler/device-simulator는 HTTP 서버가 없어 새 포트를
  // 열지 않고, 각 서비스가 이미 맺고 있는 MQTT 연결의 프레즌스(LWT+retained)를 대신 구독한다.
  private readonly serviceStatus = new Map<ServiceName, "ONLINE" | "OFFLINE">();

  async onModuleInit(): Promise<void> {
    this.mqtt = connect(process.env.MQTT_URL ?? "mqtt://localhost:1883", {
      clientId: `svc:api-${process.pid}`,
    });

    // mqtt 핸드셰이크는 아래 redis/publisher await보다 먼저 끝날 수 있다 — connect 리스너를
    // await들 뒤에 붙이면 그 사이에 이미 발생한 'connect' 이벤트를 영영 놓친다(레이스).
    // 그래서 리스너 등록을 client 생성 직후, 어떤 await보다도 앞에 둔다.
    this.mqtt.on("connect", () => {
      console.log("[api] MQTT 브로커 연결 성공 - 실시간 전파");
      this.mqtt?.subscribe(buildServiceStatusWildcard(), { qos: 1 });
      if (this.publisher) {
        void publishRealtimeEvent(this.publisher, {
          type: "system.status",
          mqtt: "connected",
          ts: Date.now(),
        });
      }
    });

    this.mqtt.on("message", (topic: string, payload: Buffer) => {
      if (!topic.startsWith("platform/service/") || !topic.endsWith("/status")) return;
      try {
        const parsed = ServiceStatusPayload.safeParse(JSON.parse(payload.toString()));
        if (parsed.success) this.serviceStatus.set(parsed.data.service, parsed.data.status);
      } catch {
        // 잘못된 payload는 무시 — 다음 프레즌스 게시를 기다린다
      }
    });

    const handleDisconnect = () => {
      console.log("[api] MQTT 브로커 연결 해제 - 실시간 전파");
      if (this.publisher) {
        void publishRealtimeEvent(this.publisher, {
          type: "system.status",
          mqtt: "disconnected",
          ts: Date.now(),
        });
      }
    };

    this.mqtt.on("close", handleDisconnect);
    this.mqtt.on("offline", handleDisconnect);

    this.redis = createRedisCommandClient();
    await this.redis.connect();

    this.publisher = createRealtimePublisher();
    await this.publisher.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.mqtt) {
      await new Promise<void>((resolve) => this.mqtt?.end(false, {}, () => resolve()));
    }
    if (this.redis) {
      await this.redis.quit();
    }
    if (this.publisher) {
      await this.publisher.quit();
    }
  }

  isMqttConnected(): boolean {
    return this.mqtt?.connected ?? false;
  }

  isRedisConnected(): boolean {
    return this.redis?.isReady ?? false;
  }

  /** 서버 상태 위젯(web) 전용 — 프레즌스를 아직 한 번도 못 받은 서비스는 OFFLINE 취급. */
  getServiceStatuses(): Record<ServiceName, "ONLINE" | "OFFLINE"> {
    const result = {} as Record<ServiceName, "ONLINE" | "OFFLINE">;
    for (const service of SERVICE_NAMES) {
      result[service] = this.serviceStatus.get(service) ?? "OFFLINE";
    }
    return result;
  }

  async create(body: CreateCommandRequest, auth: AuthContext): Promise<CommandResponse> {
    const mqtt = this.mqtt;
    const redis = this.redis;
    if (!mqtt || !redis) {
      throw new BadRequestException("api command service is not ready");
    }

    const commandId = body.commandId ?? `CMD-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const sessionId = body.sessionId ?? `S-${randomUUID()}`;
    const actorType: ActorType = isAdmin(auth) ? "ADMIN" : "USER";
    const role: Role = actorRole(auth);
    const targetType = body.target?.type ?? "DEVICE";
    if (!body.command || !body.target?.id || targetType !== "DEVICE") {
      throw new BadRequestException("command and DEVICE target are required");
    }

    // 서버측 대상 해석: DB canonical mqtt_topic → UNS identity (클라이언트 입력 불신)
    const device = await getDeviceState(commandExecutor, body.target.id);
    if (!device) {
      throw new NotFoundException(`device not found: ${body.target.id}`);
    }
    const identity: DeviceIdentity | null = parseDeviceBase(device.mqttTopic);
    if (!identity) {
      throw new BadRequestException(`device has invalid mqtt_topic: ${device.code}`);
    }

    // 발행 흐름은 command-flow 단일 소스 재사용 (gateway와 동일 시퀀스·correlation)
    const result = await publishDeviceCommand(mqtt, redis, {
      commandId,
      sessionId,
      actorType,
      actorId: auth.userId,
      role,
      targetId: device.id,
      target: identity,
      command: body.command,
      ...(body.args ? { args: body.args } : {}),
    });

    return {
      commandId: result.command.commandId,
      status: result.command.status,
      published: result.published,
    };
  }

  /**
   * 그룹 일괄 제어(addendum §5) — 그룹 멤버 기기를 순차적으로 제어한다.
   * 돌입전류 완화를 위해 명령 사이에 system_setting의 순차 간격(기본 1500ms)만큼 대기한다.
   * 각 기기 명령은 표준 수명주기(CREATED→…→) + audit_log를 그대로 따른다(publishDeviceCommand 재사용).
   */
  async createGroupBatch(
    body: CreateGroupCommandRequest,
    auth: AuthContext,
  ): Promise<GroupBatchResponse> {
    const mqtt = this.mqtt;
    const redis = this.redis;
    if (!mqtt || !redis) {
      throw new BadRequestException("api command service is not ready");
    }
    if (!body.command || !body.target?.id) {
      throw new BadRequestException("command and GROUP target are required");
    }
    const groupId = body.target.id;

    const groupDevices = await listDevices(commandExecutor, { groupId });
    const deviceIds = groupDevices
      .filter(
        (device) =>
          device.deviceRole === "SENSOR" &&
          device.monitoringVisible &&
          device.enabled &&
          device.lifecycleStatus !== "DECOMMISSIONED",
      )
      .map((device) => device.id);
    if (deviceIds.length === 0) {
      throw new NotFoundException(`group not found or has no devices: ${groupId}`);
    }

    // 비관리자는 그룹 내 모든 기기에 CONTROL 권한이 있어야 한다(부분 실행 방지, all-or-nothing).
    if (!isAdmin(auth)) {
      for (const id of deviceIds) {
        const access = await getDeviceAccessLevel(commandExecutor, auth.userId, id);
        if (!access || !hasAccessLevel(access, "CONTROL")) {
          throw new ForbiddenException(`device access denied within group: ${id}`);
        }
      }
    }

    const intervalMs = await getSequentialIntervalMs(commandExecutor);
    const actorType: ActorType = isAdmin(auth) ? "ADMIN" : "USER";
    const role: Role = actorRole(auth);
    const sessionId = body.sessionId ?? `S-${randomUUID()}`;

    const results: GroupBatchItem[] = [];
    for (let i = 0; i < deviceIds.length; i++) {
      const deviceId = deviceIds[i]!;
      const device = await getDeviceState(commandExecutor, deviceId);
      const identity: DeviceIdentity | null = device ? parseDeviceBase(device.mqttTopic) : null;
      if (!device || !identity) {
        results.push({ deviceId, error: device ? "invalid mqtt_topic" : "device not found" });
      } else {
        const commandId = `CMD-${Date.now()}-${randomUUID().slice(0, 8)}`;
        const result = await publishDeviceCommand(mqtt, redis, {
          commandId,
          sessionId,
          actorType,
          actorId: auth.userId,
          role,
          targetId: device.id,
          target: identity,
          command: body.command,
          ...(body.args ? { args: body.args } : {}),
        });
        results.push({
          deviceId,
          commandId: result.command.commandId,
          status: result.command.status,
          published: result.published,
        });
      }
      // 마지막 기기가 아니면 순차 간격만큼 대기(돌입전류 완화, addendum §5).
      if (i < deviceIds.length - 1) {
        await sleep(intervalMs);
      }
    }

    return { groupId, command: body.command, intervalMs, count: results.length, results };
  }

  async get(commandId: string): Promise<unknown> {
    const command = await getCommandById(commandExecutor, commandId);
    if (!command) {
      throw new NotFoundException(`command not found: ${commandId}`);
    }
    return command;
  }

  /**
   * HITL 승인(또는 confidence≥임계치+비고위험 자동승인) 후 실제 제어 발행 — RecommendationsService
   * 전용. actorType은 항상 AI로 고정한다(PROJECT_RULES §9 "AI가 유발한 제어의 Audit_Log
   * Actor Type은 AI"). role은 특정 human role이 없는 AI 액터라 null(scheduler의 SYSTEM 액터와
   * 동일 패턴 — MQTT User Property Role은 command-flow가 ADMIN으로 폴백).
   */
  async dispatchAsAi(deviceId: string, command: string, args?: Record<string, unknown>): Promise<CommandResponse> {
    const mqtt = this.mqtt;
    const redis = this.redis;
    if (!mqtt || !redis) {
      throw new BadRequestException("api command service is not ready");
    }

    const device = await getDeviceState(commandExecutor, deviceId);
    if (!device) {
      throw new NotFoundException(`device not found: ${deviceId}`);
    }
    const identity: DeviceIdentity | null = parseDeviceBase(device.mqttTopic);
    if (!identity) {
      throw new BadRequestException(`device has invalid mqtt_topic: ${device.code}`);
    }

    const commandId = `CMD-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const sessionId = `S-${randomUUID()}`;
    const result = await publishDeviceCommand(mqtt, redis, {
      commandId,
      sessionId,
      actorType: "AI",
      actorId: null,
      role: null,
      targetId: device.id,
      target: identity,
      command,
      ...(args ? { args } : {}),
    });

    return {
      commandId: result.command.commandId,
      status: result.command.status,
      published: result.published,
    };
  }
}
