import { startTestInfra, type TestInfra } from "./infra.js";
import { runMigrations } from "./migrate.js";
import { runSeed } from "./seed.js";

export { startTestInfra, type TestInfra } from "./infra.js";
export { runMigrations } from "./migrate.js";
export { runSeed } from "./seed.js";
export { waitFor } from "./wait.js";

/**
 * Postgres+Redis+Mosquitto 컨테이너 기동 → 마이그레이션 → 시드까지 한 번에 준비한다.
 * apps/api·apps/gateway 통합 테스트의 `beforeAll`에서 공용으로 쓴다.
 */
export async function startTestEnvironment(): Promise<TestInfra> {
  const infra = await startTestInfra();
  await runMigrations(infra.databaseUrl);
  await runSeed(infra.databaseUrl);
  return infra;
}
