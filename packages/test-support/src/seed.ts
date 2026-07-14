import { runInDbPackage } from "./process.js";

/**
 * `packages/db/src/seed.ts`(admin/thermostat-01/거실·침실 Area)를 대상 DB에 적용한다.
 * seed 스크립트는 끝에서 `process.exit(0)`을 호출하므로 반드시 별도 프로세스로 실행해야 한다
 * (테스트 프로세스로 import하면 워커가 함께 종료된다).
 */
export async function runSeed(databaseUrl: string): Promise<void> {
  await runInDbPackage(["node", "dist/seed.js"], {
    ...process.env,
    DATABASE_URL: databaseUrl,
  });
}
