import { VirtualDevice } from "./virtual-device.js";

/**
 * @smarthome/device-simulator — M1: 가상 기기 1대 (docs/device-simulator.md §15).
 * connect + LWT + state(retained) + telemetry(sine). 실기기 없이 데이터 흐름 확보.
 * 환경변수: MQTT_URL(기본 mqtt://localhost:1883), SIM_RUN_MS(>0 이면 해당 시간 후 종료).
 */
export function main(): void {
  const url = process.env.MQTT_URL ?? "mqtt://localhost:1883";
  const runMs = Number(process.env.SIM_RUN_MS ?? "0");

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
  });

  console.log(
    `[simulator M1] ${url} 연결 시도 — thermostat-01 (SIM_RUN_MS=${runMs > 0 ? runMs : "무한"})`,
  );
  device.start();

  const shutdown = (): void => {
    void device.stop().then(() => process.exit(0));
  };
  if (runMs > 0) {
    setTimeout(shutdown, runMs);
  }
  process.on("SIGINT", shutdown);
}

main();
