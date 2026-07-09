import { createClient } from "redis";
import { REALTIME_CHANNEL, RealtimeEvent } from "@smarthome/contracts";

/**
 * gateway가 publish, api가 subscribe. node-redis는 subscribe 호출 시 클라이언트가
 * 구독 전용 모드로 전환되므로, publish용과 subscribe용은 항상 별도 연결을 쓴다.
 */
export interface RealtimePublisher {
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  on(event: "error", listener: (err: Error) => void): unknown;
  publish(channel: string, message: string): Promise<number>;
}

export interface RealtimeSubscriber {
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  on(event: "error", listener: (err: Error) => void): unknown;
  subscribe(channel: string, listener: (message: string) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
}

function redisUrl(url?: string): string {
  return url ?? process.env.REDIS_URL ?? "redis://localhost:6379";
}

export function createRealtimePublisher(url?: string): RealtimePublisher {
  const client = createClient({ url: redisUrl(url) });
  client.on("error", (err) => console.error(`[realtime] publisher redis error: ${err.message}`));
  return client as unknown as RealtimePublisher;
}

export function createRealtimeSubscriber(url?: string): RealtimeSubscriber {
  const client = createClient({ url: redisUrl(url) });
  client.on("error", (err) => console.error(`[realtime] subscriber redis error: ${err.message}`));
  return client as unknown as RealtimeSubscriber;
}

export async function publishRealtimeEvent(
  publisher: RealtimePublisher,
  event: RealtimeEvent,
): Promise<void> {
  await publisher.publish(REALTIME_CHANNEL, JSON.stringify(event));
}

/** 채널을 구독하고, 유효한 RealtimeEvent만 골라 onEvent로 전달한다(파싱 실패는 무시). */
export async function subscribeRealtimeEvents(
  subscriber: RealtimeSubscriber,
  onEvent: (event: RealtimeEvent) => void,
): Promise<void> {
  await subscriber.subscribe(REALTIME_CHANNEL, (message: string) => {
    let json: unknown;
    try {
      json = JSON.parse(message);
    } catch {
      return;
    }
    const parsed = RealtimeEvent.safeParse(json);
    if (parsed.success) onEvent(parsed.data);
  });
}

export { REALTIME_CHANNEL, RealtimeEvent } from "@smarthome/contracts";
