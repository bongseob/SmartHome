import { defineConfig } from "vitest/config";

// 유닛 테스트 전용 — Docker 없이도 빠르게 도는 `pnpm test`. 통합 테스트는
// `*.integration.test.ts`로 분리해 `vitest.integration.config.ts`(test:integration)에서만 돈다.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
  },
});
