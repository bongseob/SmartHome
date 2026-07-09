import { publishOptionsFor } from "@smarthome/mqtt";

/**
 * @smarthome/gateway — MQTT ingest/command/ack/LWT/alarm (docs/architecture.md §8).
 * TODO: Mosquitto 연결, 공유구독($share), 명령 ack 상관(Redis), 타임아웃 스위퍼,
 *       텔레메트리 배치 insert, LWT/Offline 처리.
 */
export function main(): void {
  const cmd = publishOptionsFor("cmd");
  console.log(
    `[gateway] 스캐폴딩 OK — cmd 발행 옵션=${JSON.stringify(cmd)}. 구현 예정(docs/architecture.md §8).`,
  );
}

main();
