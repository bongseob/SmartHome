import { randomBytes } from "node:crypto";
import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { createRedisCommandClient, type RedisCommandClient } from "@smarthome/command-flow";

const TICKET_PREFIX = "ws-ticket:";
const TICKET_TTL_MS = 30_000;

/**
 * WebSocket 연결용 일회용 티켓(코드 리뷰 P2 #22) — 브라우저 WebSocket API는 커스텀 헤더를
 * 못 보내 예전엔 장기(15분) access token을 그대로 쿼리스트링에 실어 보냈다. 프록시/APM/서버
 * 접근 로그에 토큰이 그대로 남는 문제가 있었다 — 이제는 인증된 사용자가 짧은 REST 호출로
 * 30초짜리 1회용 ticket을 발급받고, 그 ticket만 쿼리스트링에 싣는다. ticket 자체는 실제
 * 권한을 담고 있지 않고(Redis에 저장된 AuthContext를 가리키는 무작위 키일 뿐), 소비 즉시
 * 삭제되어 재사용도 안 된다.
 */
@Injectable()
export class WsTicketService implements OnModuleInit, OnModuleDestroy {
  private redis: RedisCommandClient | undefined;

  async onModuleInit(): Promise<void> {
    this.redis = createRedisCommandClient();
    await this.redis.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit();
  }

  async issueTicket(auth: AuthContext): Promise<string> {
    if (!this.redis) throw new Error("ws ticket store is not ready");
    const ticket = randomBytes(24).toString("base64url");
    await this.redis.set(`${TICKET_PREFIX}${ticket}`, JSON.stringify(auth), {
      PX: TICKET_TTL_MS,
      NX: true,
    });
    return ticket;
  }

  /** 존재하면 즉시 삭제(1회용)하고 담겨 있던 AuthContext를 반환한다. 없거나 만료됐으면 null. */
  async consumeTicket(ticket: string): Promise<AuthContext | null> {
    if (!this.redis) return null;
    const key = `${TICKET_PREFIX}${ticket}`;
    const raw = await this.redis.get(key);
    if (!raw) return null;
    await this.redis.del(key);
    try {
      return JSON.parse(raw) as AuthContext;
    } catch {
      return null;
    }
  }
}
