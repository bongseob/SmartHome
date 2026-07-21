import "reflect-metadata";
import { readFileSync } from "node:fs";
import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Server as HttpServer } from "node:http";
import { AppModule } from "./modules/app.module.js";
import { WsTicketService } from "./auth/ws-ticket.service.js";
import { ProblemJsonFilter } from "./filters/problem-json.filter.js";
import { RealtimeWsServer } from "./realtime/realtime-ws.server.js";
import { ensureFloorMapsDir, UPLOADS_ROOT } from "./config/uploads.js";

// node-redis(v4)는 소켓이 예기치 않게 끊기면(Redis 재기동 등) 내부적으로 'error'를
// 재전파하지 못하고 uncaughtException으로 새는 경우가 있다 — client.on("error", ...)를
// 붙여도 프로세스가 죽을 수 있다는 뜻이다. 재연결은 라이브러리가 기본 전략으로 알아서
// 재시도하므로, 여기서는 로그만 남기고 프로세스를 계속 살려둔다(크래시 방지).
process.on("uncaughtException", (err) => {
  console.error("[api] 처리되지 않은 예외(계속 실행):", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[api] 처리되지 않은 프로미스 거부(계속 실행):", reason);
});

/**
 * TLS(https/wss, PROJECT_RULES §5.1) — TLS_CERT_FILE/TLS_KEY_FILE이 둘 다 있으면 NestJS가
 * https.Server로 뜨고, RealtimeWsServer(ws 패키지)는 그 서버에 그대로 attach되므로 wss도
 * 자동으로 따라온다. 개발(두 env 없음)에서는 http로 그대로 동작한다.
 */
function loadHttpsOptions(): { cert: Buffer; key: Buffer } | undefined {
  const certFile = process.env.TLS_CERT_FILE;
  const keyFile = process.env.TLS_KEY_FILE;
  if (!certFile || !keyFile) return undefined;
  return { cert: readFileSync(certFile), key: readFileSync(keyFile) };
}

export async function main(): Promise<void> {
  ensureFloorMapsDir();
  const httpsOptions = loadHttpsOptions();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    ...(httpsOptions ? { httpsOptions } : {}),
  });
  // refresh_token 쿠키를 컨트롤러에서 읽으려면 요청 파싱이 필요하다(코드 리뷰 P2 #22).
  app.use(cookieParser());
  // cors:true(요청 Origin을 그대로 반사)로는 credentials:include 쿠키를 브라우저가 거부한다 —
  // 쿠키를 쓰려면 origin을 명시하고 credentials:true를 켜야 한다. 여러 origin을 허용하려면
  // WEB_ORIGIN에 쉼표로 구분해 넣는다(예: 운영 도메인 + 사내 접속용 IP).
  const webOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: webOrigins, credentials: true });
  app.useGlobalFilters(new ProblemJsonFilter());
  // 도면 이미지(M16) — 로컬 파일시스템에 저장된 파일을 /uploads/... 경로로 정적 서빙
  app.useStaticAssets(UPLOADS_ROOT, { prefix: "/uploads" });
  const port = Number(process.env.API_PORT ?? "3000");
  await app.listen(port);

  const wsTicketService = app.get(WsTicketService);
  const realtime = new RealtimeWsServer(app.getHttpServer() as HttpServer, wsTicketService);
  await realtime.start();

  const scheme = httpsOptions ? "https" : "http";
  console.log(`[api] listening on ${scheme}://localhost:${port}`);

  const shutdown = (): void => {
    void realtime.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main().catch((err: unknown) => {
  console.error("[api] fatal:", err);
  process.exit(1);
});
