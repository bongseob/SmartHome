import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { Server as HttpServer } from "node:http";
import { AppModule } from "./modules/app.module.js";
import { ProblemJsonFilter } from "./filters/problem-json.filter.js";
import { RealtimeWsServer } from "./realtime/realtime-ws.server.js";

export async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { cors: true });
  app.useGlobalFilters(new ProblemJsonFilter());
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
