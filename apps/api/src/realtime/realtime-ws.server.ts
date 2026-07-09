import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { verifyJwt } from "@smarthome/auth";
import type { RealtimeEvent } from "@smarthome/contracts";
import {
  createRealtimeSubscriber,
  subscribeRealtimeEvents,
  type RealtimeSubscriber,
} from "@smarthome/realtime";

/**
 * WebSocket 대시보드 브리지 (docs/api-spec.md §10 GET /ws/realtime).
 * 인증: 브라우저 WebSocket API는 커스텀 헤더를 못 보내므로 쿼리스트링 `?token=<JWT>`로 전달.
 * 현재는 인증된 전 연결에 전체 브로드캐스트한다(Area 단위 필터링은 후속 — tracker 기록).
 */
export class RealtimeWsServer {
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  private subscriber: RealtimeSubscriber | undefined;

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
    try {
      verifyJwt(token, secret, "access");
    } catch {
      socket.close(4401, "unauthorized");
      return;
    }

    this.clients.add(socket);
    socket.on("close", () => this.clients.delete(socket));
    socket.on("error", () => this.clients.delete(socket));
  }

  private broadcast(event: RealtimeEvent): void {
    const message = JSON.stringify(event);
    for (const socket of this.clients) {
      if (socket.readyState === socket.OPEN) socket.send(message);
    }
  }

  async start(): Promise<void> {
    this.subscriber = createRealtimeSubscriber();
    await this.subscriber.connect();
    await subscribeRealtimeEvents(this.subscriber, (event) => this.broadcast(event));
    console.log("[api] /ws/realtime 활성화 (redis 구독)");
  }

  async close(): Promise<void> {
    for (const socket of this.clients) socket.close(1001, "server shutdown");
    this.clients.clear();
    this.wss.close();
    if (this.subscriber) await this.subscriber.quit();
  }
}
