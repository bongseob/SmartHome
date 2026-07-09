import { createClient } from "redis";
import type { ExecutionStatus } from "@smarthome/contracts";

const TIMEOUT_ZSET = "cmd:timeouts";
const KEY_PREFIX = "cmd:";

export type CorrelationStatus = Extract<ExecutionStatus, "PENDING" | "IN_PROGRESS">;

export interface CommandCorrelationState {
  commandId: string;
  deviceCode: string;
  sessionId: string;
  status: CorrelationStatus;
  deadlineEpochMs: number;
}

export interface RedisCommandClient {
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  on(event: "error", listener: (err: Error) => void): unknown;
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options?: { PX?: number; NX?: boolean; XX?: boolean },
  ): Promise<string | null>;
  del(key: string): Promise<number>;
  zAdd(key: string, item: { score: number; value: string }): Promise<number>;
  zRem(key: string, member: string): Promise<number>;
  zRangeByScore(key: string, min: number, max: number): Promise<string[]>;
}

export function commandKey(commandId: string): string {
  return `${KEY_PREFIX}${commandId}`;
}

export function defaultCommandSlaMs(): number {
  const parsed = Number(process.env.COMMAND_SLA_MS ?? "30000");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000;
}

export function createRedisCommandClient(
  url: string = process.env.REDIS_URL ?? "redis://localhost:6379",
): RedisCommandClient {
  const client = createClient({ url });
  client.on("error", (err) => console.error(`[command-flow] redis error: ${err.message}`));
  return client as unknown as RedisCommandClient;
}

export async function storeNewCorrelation(
  redis: RedisCommandClient,
  state: CommandCorrelationState,
  ttlMs: number,
): Promise<boolean> {
  const stored = await redis.set(commandKey(state.commandId), JSON.stringify(state), {
    PX: ttlMs,
    NX: true,
  });
  if (stored !== "OK") return false;
  await redis.zAdd(TIMEOUT_ZSET, { score: state.deadlineEpochMs, value: state.commandId });
  return true;
}

export async function updateCorrelationStatus(
  redis: RedisCommandClient,
  state: CommandCorrelationState,
  ttlMs: number,
): Promise<boolean> {
  const stored = await redis.set(commandKey(state.commandId), JSON.stringify(state), {
    PX: ttlMs,
    XX: true,
  });
  return stored === "OK";
}

export async function getCorrelation(
  redis: RedisCommandClient,
  commandId: string,
): Promise<CommandCorrelationState | null> {
  const raw = await redis.get(commandKey(commandId));
  if (!raw) return null;
  const parsed = JSON.parse(raw) as CommandCorrelationState;
  return parsed;
}

export async function clearCorrelation(
  redis: RedisCommandClient,
  commandId: string,
): Promise<void> {
  await redis.del(commandKey(commandId));
  await redis.zRem(TIMEOUT_ZSET, commandId);
}

export async function dueCommandIds(
  redis: RedisCommandClient,
  nowEpochMs: number = Date.now(),
): Promise<string[]> {
  return redis.zRangeByScore(TIMEOUT_ZSET, 0, nowEpochMs);
}
