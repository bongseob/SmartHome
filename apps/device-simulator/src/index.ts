import { buildTopic } from "@smarthome/contracts";
import { publishOptionsFor } from "@smarthome/mqtt";

/**
 * @smarthome/device-simulator — 가상 기기 (docs/device-simulator.md).
 * contracts 재사용 → gateway 입장에서 실기기와 구분 불가.
 * TODO: fleet 로드, 상태머신(connect/LWT/state/telemetry/cmd-ack), 결함/시나리오 주입.
 */
export function main(): void {
  const topic = buildTopic({
    site: "site1",
    building: "bldg-a",
    floor: "2f",
    area: "living-room",
    device: "light-01",
    suffix: "telemetry",
  });
  console.log(
    `[simulator] 스캐폴딩 OK — 예시 토픽=${topic}, 발행옵션=${JSON.stringify(publishOptionsFor("telemetry"))}. 구현 예정.`,
  );
}

main();
