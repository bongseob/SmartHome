import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import { actorRole, isAdmin, type AuthContext } from "@smarthome/auth";
import {
  CommandPayload,
  type ActorType,
  type Role,
  type TargetType,
} from "@smarthome/contracts";
import { connect, publish, type DeviceIdentity, type MqttClient } from "@smarthome/mqtt";
import {
  createCommandWithAuditResult,
  getCommandById,
  query,
  transitionCommandWithAudit,
} from "@smarthome/db";

interface CommandTargetRequest extends DeviceIdentity {
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

const commandExecutor = { query };

function commandKey(commandId: string): string {
  return `cmd:${commandId}`;
}

function commandSlaMs(): number {
  const parsed = Number(process.env.COMMAND_SLA_MS ?? "30000");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000;
}

@Injectable()
export class CommandsService implements OnModuleInit, OnModuleDestroy {
  private mqtt: MqttClient | undefined;
  private redis: RedisClientType | undefined;

  async onModuleInit(): Promise<void> {
    this.mqtt = connect(process.env.MQTT_URL ?? "mqtt://localhost:1883", {
      clientId: `svc:api-${process.pid}`,
    });
    this.redis = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379" });
    this.redis.on("error", (err) => console.error(`[api] redis error: ${err.message}`));
    await this.redis.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.mqtt) {
      await new Promise<void>((resolve) => this.mqtt?.end(false, {}, () => resolve()));
    }
    if (this.redis) {
      await this.redis.quit();
    }
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

    const timestamp = Date.now();
    const payload = CommandPayload.parse({
      sessionId,
      commandId,
      command: body.command,
      target: body.target.device,
      timestamp,
      ...(body.args ? { args: body.args } : {}),
    });

    const created = await createCommandWithAuditResult({
      commandId,
      sessionId,
      actorType,
      actorId: auth.userId,
      role,
      targetType,
      targetId: body.target.id,
      command: body.command,
      payload,
    });
    if (!created.inserted) {
      return {
        commandId: created.command.commandId,
        status: created.command.status,
        published: false,
      };
    }

    await transitionCommandWithAudit({
      commandId,
      toStatus: "PENDING",
      reason: "api command accepted for mqtt publish",
    });

    const slaMs = commandSlaMs();
    const deadlineEpochMs = timestamp + slaMs;
    const correlation = JSON.stringify({
      commandId,
      deviceCode: body.target.device,
      sessionId,
      status: "PENDING",
      deadlineEpochMs,
    });
    const stored = await redis.set(commandKey(commandId), correlation, {
      PX: slaMs + 5000,
      NX: true,
    });
    if (stored !== "OK") {
      throw new BadRequestException(`command correlation already exists: ${commandId}`);
    }
    await redis.zAdd("cmd:timeouts", { score: deadlineEpochMs, value: commandId });

    publish(mqtt, body.target, "cmd", payload, {
      actorId: auth.userId,
      sessionId,
      commandId,
      role,
      requestTimeMs: timestamp,
    });

    const inProgress = await transitionCommandWithAudit({
      commandId,
      toStatus: "IN_PROGRESS",
      reason: "api mqtt command published",
    });
    await redis.set(
      commandKey(commandId),
      JSON.stringify({
        commandId,
        deviceCode: body.target.device,
        sessionId,
        status: "IN_PROGRESS",
        deadlineEpochMs,
      }),
      { PX: Math.max(deadlineEpochMs - Date.now() + 5000, 1000), XX: true },
    );

    return { commandId, status: inProgress.status, published: true };
  }

  async get(commandId: string): Promise<unknown> {
    const command = await getCommandById(commandExecutor, commandId);
    if (!command) {
      throw new NotFoundException(`command not found: ${commandId}`);
    }
    return command;
  }
}
