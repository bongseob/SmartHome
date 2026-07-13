import { connect, publishServiceStatus, serviceWill, type MqttClient } from "@smarthome/mqtt";
import { VirtualDevice, type CommandFault } from "./virtual-device.js";
import { MockResponder } from "./mock-responder.js";

/**
 * @smarthome/device-simulator — M2 (docs/device-simulator.md §15).
 * connect + LWT + state(retained) + telemetry(sine) + /cmd→ack(멱등성·결함주입).
 * 환경변수:
 *  - MQTT_URL     (기본 mqtt://localhost:1883)
 *  - SIM_RUN_MS   (>0 이면 해당 시간 후 종료)
 *  - SIM_FAULT    결함 주입: "noack:<command>" | "fail:<command>[:<reasonCode>]"
 *                 예) SIM_FAULT=noack:turn_off  → turn_off에 ack 미발행(TIMED_OUT 유도)
 *                     SIM_FAULT=fail:turn_on:135 → turn_on에 FAILED(135) ack
 *  - SIM_MOCK_ALL 설정 시 단일 가상기기 대신 "전역 목 응답기"를 띄운다 —
 *                 모든 기기의 cmd에 SUCCEEDED ack + state를 발행(데모: 샘플 380기기 제어 완료).
 */
function parseFault(spec: string | undefined): CommandFault[] {
  if (!spec) return [];
  const [kind, command, code] = spec.split(":");
  if (!command) return [];
  if (kind === "noack") return [{ command, behavior: "NO_ACK" }];
  if (kind === "fail") {
    return [{ command, behavior: "FAILED", reasonCode: code ? Number(code) : 128 }];
  }
  return [];
}

/**
 * 서버 상태 위젯(web) 전용 프레즌스 커넥션 — VirtualDevice/MockResponder는 "가상 기기" 정체성으로
 * 접속하므로(기기 LWT), 이 프로세스(device-simulator 서비스) 자체의 생존 여부는 별도 연결로 알린다.
 */
function connectServicePresence(url: string): MqttClient {
  const client = connect(url, {
    clientId: `svc:device-simulator-${process.pid}`,
    will: serviceWill("device-simulator"),
  });
  client.on("connect", () => publishServiceStatus(client, "device-simulator", "ONLINE"));
  return client;
}

export function main(): void {
  const url = process.env.MQTT_URL ?? "mqtt://localhost:1883";
  const runMs = Number(process.env.SIM_RUN_MS ?? "0");
  const presence = connectServicePresence(url);

  // 전역 목 응답기 모드 — 실기기/개별 시뮬레이터 없이 모든 기기 명령을 SUCCEEDED로 완료시킨다.
  if (process.env.SIM_MOCK_ALL) {
    const responder = new MockResponder(url);
    console.log(`[simulator] ${url} — 전역 목 응답기 (run=${runMs > 0 ? `${runMs}ms` : "무한"})`);
    responder.start();
    const stop = (): void => {
      publishServiceStatus(presence, "device-simulator", "OFFLINE");
      presence.end(false, {}, () => void responder.stop().then(() => process.exit(0)));
    };
    if (runMs > 0) setTimeout(stop, runMs);
    process.on("SIGINT", stop);
    return;
  }

  const faults = parseFault(process.env.SIM_FAULT);

  const device = new VirtualDevice(url, {
    identity: {
      site: "site1",
      building: "bldg-a",
      floor: "2f",
      area: "living-room",
      device: "thermostat-01",
    },
    telemetryIntervalMs: 1000,
    metric: { name: "temperature", base: 22, amp: 2, periodS: 60 },
    faults,
  });

  console.log(
    `[simulator M2] ${url} — thermostat-01 (run=${runMs > 0 ? `${runMs}ms` : "무한"}, faults=${JSON.stringify(faults)})`,
  );
  device.start();

  const shutdown = (): void => {
    publishServiceStatus(presence, "device-simulator", "OFFLINE");
    presence.end(false, {}, () => void device.stop().then(() => process.exit(0)));
  };
  if (runMs > 0) {
    setTimeout(shutdown, runMs);
  }
  process.on("SIGINT", shutdown);
}

main();
