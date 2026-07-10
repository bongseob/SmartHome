import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Server as HttpServer } from "node:http";
import { AppModule } from "./modules/app.module.js";
import { ProblemJsonFilter } from "./filters/problem-json.filter.js";
import { RealtimeWsServer } from "./realtime/realtime-ws.server.js";
import { ensureFloorMapsDir, UPLOADS_ROOT } from "./config/uploads.js";

export async function main(): Promise<void> {
  ensureFloorMapsDir();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: true });
  app.useGlobalFilters(new ProblemJsonFilter());
  // 도면 이미지(M16) — 로컬 파일시스템에 저장된 파일을 /uploads/... 경로로 정적 서빙
  app.useStaticAssets(UPLOADS_ROOT, { prefix: "/uploads" });
  const port = Number(process.env.API_PORT ?? "3000");
  await app.listen(port);

  const realtime = new RealtimeWsServer(app.getHttpServer() as HttpServer);
  await realtime.start();

  console.log(`[api] listening on http://localhost:${port}`);

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
