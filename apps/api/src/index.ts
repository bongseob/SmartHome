import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./modules/app.module.js";
import { ProblemJsonFilter } from "./filters/problem-json.filter.js";

export async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { cors: true });
  app.useGlobalFilters(new ProblemJsonFilter());
  const port = Number(process.env.API_PORT ?? "3000");
  await app.listen(port);
  console.log(`[api] listening on http://localhost:${port}`);
}

void main().catch((err: unknown) => {
  console.error("[api] fatal:", err);
  process.exit(1);
});
