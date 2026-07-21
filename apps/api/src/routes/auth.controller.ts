import { Body, Controller, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import type { AuthContext } from "@smarthome/auth";
import { CurrentAuth, Public } from "../auth/auth.decorators.js";
import { WsTicketService } from "../auth/ws-ticket.service.js";
import { AuthService, refreshTtlSeconds, type LoginRequest, type LoginResponse } from "../services/auth.service.js";

const REFRESH_COOKIE = "refresh_token";
/** refresh 쿠키는 이 prefix로 시작하는 라우트에만 실려서, 다른 API 호출에 불필요하게 딸려가지 않는다. */
const REFRESH_COOKIE_PATH = "/api/v1/auth";

function refreshCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    // 이 프로젝트는 NODE_ENV가 아니라 TLS_CERT_FILE/TLS_KEY_FILE 유무로 운영 배포를 판별한다
    // (apps/api/src/index.ts loadHttpsOptions와 동일한 신호).
    secure: Boolean(process.env.TLS_CERT_FILE && process.env.TLS_KEY_FILE),
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    maxAge: refreshTtlSeconds() * 1000,
  };
}

/** LoginResponse에서 refreshToken을 빼고(쿠키로만 보냄) 나머지만 JSON body로 응답한다. */
function toPublicBody(result: LoginResponse): Omit<LoginResponse, "refreshToken"> {
  const { refreshToken: _refreshToken, ...rest } = result;
  return rest;
}

@Controller("api/v1/auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly wsTicket: WsTicketService,
  ) {}

  @Public()
  @Post("login")
  async login(@Body() body: LoginRequest, @Res({ passthrough: true }) res: Response): Promise<unknown> {
    const result = await this.auth.login(body);
    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
    return toPublicBody(result);
  }

  @Public()
  @Post("refresh")
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<unknown> {
    const current = (req.cookies as Record<string, string | undefined> | undefined)?.[REFRESH_COOKIE];
    const result = await this.auth.refresh(current);
    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
    return toPublicBody(result);
  }

  @Public()
  @Post("logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<unknown> {
    const current = (req.cookies as Record<string, string | undefined> | undefined)?.[REFRESH_COOKIE];
    const result = await this.auth.logout(current);
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return result;
  }

  /**
   * WebSocket 연결용 일회용 ticket 발급(코드 리뷰 P2 #22) — 이미 access token으로 인증된
   * 요청만 여기 온다(JwtAuthGuard가 앞단에서 검사). 이 ticket을 /ws/realtime?ticket=...로
   * 넘기면, 브라우저 로그/프록시에 남는 건 30초짜리 1회용 무작위 문자열뿐이다.
   */
  @Post("ws-ticket")
  async issueWsTicket(@CurrentAuth() auth: AuthContext): Promise<{ ticket: string }> {
    const ticket = await this.wsTicket.issueTicket(auth);
    return { ticket };
  }
}
