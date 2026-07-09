import { ExecutionStatus } from "@smarthome/contracts";

/**
 * @smarthome/api — REST + WebSocket (dashboard-facing) (docs/api-spec.md).
 * TODO: NestJS 부트스트랩, 인증/RBAC 가드, 제어 명령 발행, 대시보드 WS.
 */
export function main(): void {
  console.log(
    `[api] 스캐폴딩 OK — 명령 수명주기 상태=${ExecutionStatus.options.join(" → ")}. 구현 예정(docs/api-spec.md).`,
  );
}

main();
