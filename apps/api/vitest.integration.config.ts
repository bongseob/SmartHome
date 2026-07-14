import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// Testcontainers(Postgres/Redis/Mosquitto) 기동 + Nest 앱 부트스트랩이 포함돼 느리다 —
// 유닛 테스트(`pnpm test`)와 분리된 `pnpm test:integration` 전용 설정.
//
// NestJS DI는 TypeScript의 emitDecoratorMetadata(design:paramtypes)로 생성자 인자 타입을 읽는데,
// Vitest의 기본 변환기(esbuild)는 이 메타데이터를 내지 않는다 — Reflector 등 모든 생성자 주입이
// undefined가 되어 가드가 즉시 500을 던진다(공식 Nest+Vitest 레시피와 동일한 문제). swc(decoratorMetadata:
// true)로 변환기를 교체해야 실제 Nest 앱을 부트스트랩하는 통합 테스트가 동작한다.
export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    include: ["**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
