import { runInDbPackage } from "./process.js";

/** `packages/db/migrations`를 대상 DB에 적용한다(node-pg-migrate, dotenv 래퍼 없이 DATABASE_URL 직접 주입). */
export async function runMigrations(databaseUrl: string): Promise<void> {
  await runInDbPackage(["node-pg-migrate", "up", "-j", "sql", "-m", "migrations"], {
    ...process.env,
    DATABASE_URL: databaseUrl,
  });
}
