import { defineConfig } from "vitest/config";

// Testcontainers(Postgres/Redis/Mosquitto) 기동 + 빌드된 dist/index.js 자식 프로세스 스폰이
// 포함돼 느리다 — 유닛 테스트(`pnpm test`)와 분리된 `pnpm test:integration` 전용 설정.
export default defineConfig({
  test: {
    include: ["**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
