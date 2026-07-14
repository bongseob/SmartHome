// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

/**
 * 모노레포 전체를 루트에서 한 번에 훑는 단일 flat config (docs/test-strategy.md §9·§11 —
 * lint 게이트 최초 도입). 패키지별 lint 스크립트를 따로 두지 않고 `eslint .`로 전체를 검사한다
 * — pnpm workspace 하위 패키지마다 eslint를 의존성으로 추가할 필요가 없어 간단하다.
 *
 * 처음 도입이라 규칙은 최소한으로 시작한다: 실제 버그를 잡는 규칙(미사용 변수, react-hooks
 * 의존성 배열 등) 위주로, 스타일 규칙(따옴표·세미콜론 등)은 넣지 않는다(Prettier 등 별도 포매터
 * 미도입 상태이기도 함). 필요해지면 점진적으로 강화한다.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.turbo/**",
      "**/node_modules/**",
      "**/coverage/**",
      "esp32/.pio/**",
      "esp32/include/config.h",
      "**/*.tsbuildinfo",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // 이미 tsconfig(strict) + 컴파일러가 잡는 것과 겹치는 잡음성 규칙은 끈다.
      "@typescript-eslint/no-explicit-any": "off",
      // 의도적으로 안 쓰는 매개변수(콜백 시그니처 맞추기 등)는 _ 접두사로 허용.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // vitest 테스트 파일 — describe/it/expect 전역은 각 파일에서 import해서 쓰므로 추가 설정 불필요.
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  {
    // .cjs는 CommonJS임을 확장자로 명시한 파일이라 require()가 정상 관용구다.
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
