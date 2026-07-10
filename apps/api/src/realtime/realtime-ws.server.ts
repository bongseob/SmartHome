import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { hasAreaAccess, isAdmin, verifyJwt, type AuthContext } from "@smarthome/auth";
import type { RealtimeEvent } from "@smarthome/contracts";
import { listDevices, query } from "@smarthome/db";
import {
  createRealtimeSubscriber,
  subscribeRealtimeEvents,
  type RealtimeSubscriber,
} from "@smarthome/realtime";

const executor = { query };
const DEVICE_AREA_REFRESH_MS = 30_000;

interface ClientEntry {
  socket: WebSocket;
  auth: AuthContext;
}

/**
 * WebSocket 대시보드 브리지 (docs/api-spec.md §10 GET /ws/realtime).
 * 인증: 브라우저 WebSocket API는 커스텀 헤더를 못 보내므로 쿼리스트링 `?token=<JWT>`로 전달.
 *
 * area 스코프 필터링(M7/M8 이월 부채 해소): 기기와 연관된 이벤트는 device→area 매핑을 30초
 * 캐시로 조회해 연결의 JWT `topics` claim과 대조한다(ADMIN은 전체 수신). 캐시에 없는 기기·area
 * 미배정 기기는 안전하게 숨긴다(fail-closed) — REST 목록 API(devices/spatial)와 동일한 정책.
 */
export class RealtimeWsServer {
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<ClientEntry>();
  private subscriber: RealtimeSubscriber | undefined;
  private deviceAreaCache = new Map<string, string | null>();
  private cacheRefreshTimer: ReturnType<typeof setInterval> | undefined;

  constructor(httpServer: HttpServer, path = "/ws/realtime") {
    this.wss = new WebSocketServer({ server: httpServer, path });
    this.wss.on("connection", (socket, request) => this.onConnection(socket, request.url));
  }

  private onConnection(socket: WebSocket, url: string | undefined): void {
    const token = new URL(url ?? "", "http://internal").searchParams.get("token");
    const secret = process.env.AUTH_JWT_SECRET;
    if (!token || !secret) {
      socket.close(4401, "unauthorized");
      return;
    }
    let auth: AuthContext;
    try {
      auth = verifyJwt(token, secret, "access");
    } catch {
      socket.close(4401, "unauthorized");
      return;
    }

    const entry: ClientEntry = { socket, auth };
    this.clients.add(entry);
    socket.on("close", () => this.clients.delete(entry));
    socket.on("error", () => this.clients.delete(entry));
  }

  private async refreshDeviceAreaCache(): Promise<void> {
    try {
      const devices = await listDevices(executor);
      const next = new Map<string, string | null>();
      for (const device of devices) {
        next.set(device.id, device.areaTopicPrefix);
      }
      this.deviceAreaCache = next;
    } catch (err) {
      console.error("[api] realtime device-area 캐시 갱신 실패:", err);
    }
  }

  /** 이벤트가 어떤 기기와 관련되는지 추출한다. GROUP 대상 등 기기 하나로 특정 안 되면 null. */
  private eventDeviceId(event: RealtimeEvent): string | null {
    if (event.type === "device.state") return event.deviceId;
    if (event.type === "alarm.raised" || event.type === "alarm.updated") return event.deviceId;
    if (event.type === "command.status") return event.targetType === "DEVICE" ? event.targetId : null;
    return null;
  }

  private isVisible(auth: AuthContext, event: RealtimeEvent): boolean {
    if (isAdmin(auth)) return true;

    const deviceId = this.eventDeviceId(event);
    if (deviceId === null) {
      // 기기 하나로 스코프할 수 없는 이벤트: 기기 없는 알람(전사 공지성)은 전체에 알리고,
      // 그 외(GROUP 대상 command.status 등)는 area를 판정할 수 없으니 안전하게 숨긴다.
      return event.type === "alarm.raised" || event.type === "alarm.updated";
    }

    const areaPrefix = this.deviceAreaCache.get(deviceId);
    if (!areaPrefix) return false; // 캐시 미반영 또는 area 미배정 — 안전하게 숨긴다
    return hasAreaAccess(auth, areaPrefix);
  }

  private broadcast(event: RealtimeEvent): void {
    const message = JSON.stringify(event);
    for (const { socket, auth } of this.clients) {
      if (socket.readyState !== socket.OPEN) continue;
      if (!this.isVisible(auth, event)) continue;
      socket.send(message);
    }
  }

  async start(): Promise<void> {
    await this.refreshDeviceAreaCache();
    this.cacheRefreshTimer = setInterval(() => void this.refreshDeviceAreaCache(), DEVICE_AREA_REFRESH_MS);

    this.subscriber = createRealtimeSubscriber();
    await this.subscriber.connect();
    await subscribeRealtimeEvents(this.subscriber, (event) => this.broadcast(event));
    console.log("[api] /ws/realtime 활성화 (redis 구독, area 스코프 필터링)");
  }

  async close(): Promise<void> {
    if (this.cacheRefreshTimer) clearInterval(this.cacheRefreshTimer);
    for (const { socket } of this.clients) socket.close(1001, "server shutdown");
    this.clients.clear();
    this.wss.close();
    if (this.subscriber) await this.subscriber.quit();
  }
}
