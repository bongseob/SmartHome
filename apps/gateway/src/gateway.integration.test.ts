import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestEnvironment, waitFor, type TestInfra } from "@smarthome/test-support";
import { connect, publish, topicFor, type DeviceIdentity, type MqttClient } from "@smarthome/mqtt";
import {
  createRedisCommandClient,
  publishDeviceCommand,
  type RedisCommandClient,
} from "@smarthome/command-flow";
import { closePool, query } from "@smarthome/db";

/**
 * gateway↔broker↔DB 통합 테스트 (docs/test-strategy.md §2). `apps/gateway/src/index.ts`는
 * 최상위에서 즉시 실행되는 무한루프 프로세스라 import로 재사용할 수 없다 — 빌드 산출물을
 * 자식 프로세스로 스폰해 블랙박스로 검증한다.
 */

const GATEWAY_DIST_ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/index.js");

const THERMOSTAT: DeviceIdentity = {
  site: "site1",
  building: "bldg-a",
  floor: "2f",
  area: "living-room",
  device: "thermostat-01",
};
const LIGHT_01: DeviceIdentity = {
  site: "site1",
  building: "bldg-a",
  floor: "2f",
  area: "living-room",
  device: "light-01",
};
const LIGHT_02: DeviceIdentity = {
  site: "site1",
  building: "bldg-a",
  floor: "2f",
  area: "bedroom",
  device: "light-02",
};

let infra: TestInfra;
let gatewayProcess: ChildProcess;
let testClient: MqttClient;
let redis: RedisCommandClient;

async function deviceIdFor(code: string): Promise<string> {
  const result = await query<{ id: string }>("SELECT id FROM device WHERE code = $1", [code]);
  const row = result.rows[0];
  if (!row) throw new Error(`시드에 device '${code}'가 없다`);
  return row.id;
}

beforeAll(async () => {
  infra = await startTestEnvironment();
  process.env.DATABASE_URL = infra.databaseUrl;

  gatewayProcess = spawn(process.execPath, [GATEWAY_DIST_ENTRY], {
    env: {
      ...process.env,
      DATABASE_URL: infra.databaseUrl,
      REDIS_URL: infra.redisUrl,
      MQTT_URL: infra.mqttUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const readySignal = new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(
      () => reject(new Error("gateway 프로세스가 제한 시간 내에 기동하지 않았다")),
      20_000,
    );
    gatewayProcess.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("공유구독 시작")) {
        clearTimeout(timer);
        resolvePromise();
      }
    });
  });
  gatewayProcess.stderr?.on("data", (chunk: Buffer) => {
    console.error(`[gateway child] ${chunk.toString()}`);
  });
  await readySignal;

  testClient = connect(infra.mqttUrl, { clientId: "test:gateway-integration" });
  await new Promise<void>((resolvePromise, reject) => {
    testClient.on("connect", () => resolvePromise());
    testClient.on("error", reject);
  });

  redis = createRedisCommandClient(infra.redisUrl);
  await redis.connect();
}, 60_000);

afterAll(async () => {
  await redis?.quit();
  testClient?.end(true);
  if (gatewayProcess) {
    gatewayProcess.kill();
  }
  await closePool();
  await infra?.stop();
});

describe("gateway 통합 — telemetry 인제스트", () => {
  it("telemetry 발행이 DB에 적재된다", async () => {
    const deviceId = await deviceIdFor("thermostat-01");
    const metricValue = 21.5 + Math.random();
    publish(testClient, THERMOSTAT, "telemetry", { ts: Date.now(), metrics: { temperature: metricValue } });

    const row = await waitFor(
      async () => {
        const result = await query<{ value_num: number }>(
          `SELECT value_num FROM telemetry WHERE device_id = $1 AND metric = 'temperature' ORDER BY "time" DESC LIMIT 1`,
          [deviceId],
        );
        const found = result.rows[0];
        return found && Math.abs(found.value_num - metricValue) < 1e-6 ? found : undefined;
      },
      { message: "telemetry가 제한 시간 내에 적재되지 않았다" },
    );
    expect(row.value_num).toBeCloseTo(metricValue);
  });
});

describe("gateway 통합 — 현장 상태 변화 → alarm", () => {
  it("OFFLINE state 수신 시 device 상태 갱신 + alarm_log 생성", async () => {
    const deviceId = await deviceIdFor("light-01");
    publish(testClient, LIGHT_01, "state", { status: "OFFLINE", ts: Date.now() });

    await waitFor(
      async () => {
        const result = await query<{ current_status: string }>(
          "SELECT current_status FROM device WHERE id = $1",
          [deviceId],
        );
        return result.rows[0]?.current_status === "OFFLINE" ? true : undefined;
      },
      { message: "device.current_status가 OFFLINE으로 갱신되지 않았다" },
    );

    const alarm = await waitFor(
      async () => {
        const result = await query<{ id: number; message: string | null }>(
          "SELECT id, message FROM alarm_log WHERE device_id = $1 ORDER BY id DESC LIMIT 1",
          [deviceId],
        );
        return result.rows[0];
      },
      { message: "alarm_log가 생성되지 않았다" },
    );
    expect(alarm.message).toContain("offline");
  });
});

describe("gateway 통합 — 명령 발행 → device ack 왕복", () => {
  it("cmd 발행 후 SUCCEEDED ack가 command/audit_log에 반영된다", async () => {
    const deviceId = await deviceIdFor("light-02");
    const commandId = `test-cmd-${Date.now()}`;
    const cmdTopic = topicFor(LIGHT_02, "cmd");

    const ackSent = new Promise<void>((resolvePromise) => {
      const onMessage = (topic: string, payload: Buffer): void => {
        if (topic !== cmdTopic) return;
        const received = JSON.parse(payload.toString()) as { commandId: string };
        if (received.commandId !== commandId) return;
        testClient.unsubscribe(cmdTopic);
        testClient.removeListener("message", onMessage);
        publish(testClient, LIGHT_02, "cmd/ack", {
          commandId,
          status: "SUCCEEDED",
          ts: Date.now(),
          deviceId: "light-02",
        });
        resolvePromise();
      };
      testClient.on("message", onMessage);
    });
    await new Promise<void>((resolvePromise, reject) => {
      testClient.subscribe(cmdTopic, { qos: 1 }, (err) => (err ? reject(err) : resolvePromise()));
    });

    await publishDeviceCommand(testClient, redis, {
      commandId,
      sessionId: "test-session",
      actorType: "USER",
      actorId: null,
      role: "ADMIN",
      targetId: deviceId,
      target: LIGHT_02,
      command: "turn_on",
    });

    await ackSent;

    await waitFor(
      async () => {
        const result = await query<{ status: string }>(
          "SELECT status FROM command WHERE command_id = $1",
          [commandId],
        );
        return result.rows[0]?.status === "SUCCEEDED" ? true : undefined;
      },
      { message: "command가 SUCCEEDED로 종결되지 않았다" },
    );

    const audit = await query<{ execution_status: string }>(
      "SELECT execution_status FROM audit_log WHERE command_id = $1 ORDER BY log_id ASC",
      [commandId],
    );
    const statuses = audit.rows.map((r) => r.execution_status);
    expect(statuses).toEqual(
      expect.arrayContaining(["CREATED", "PENDING", "IN_PROGRESS", "SUCCEEDED"]),
    );
  });

  it("query_state 명령도 동일한 수명주기·Audit_Log로 처리된다(신규 command 문자열 하드코딩 불필요 검증)", async () => {
    const deviceId = await deviceIdFor("thermostat-01");
    const commandId = `test-cmd-${Date.now()}`;
    const cmdTopic = topicFor(THERMOSTAT, "cmd");

    const ackSent = new Promise<void>((resolvePromise) => {
      const onMessage = (topic: string, payload: Buffer): void => {
        if (topic !== cmdTopic) return;
        const received = JSON.parse(payload.toString()) as { commandId: string; command: string };
        if (received.commandId !== commandId) return;
        testClient.unsubscribe(cmdTopic);
        testClient.removeListener("message", onMessage);
        expect(received.command).toBe("query_state");
        // 실기기라면 여기서 현재 retained state를 재발행한다(VirtualDevice.handleCommand와 동일 동작)
        publish(testClient, THERMOSTAT, "state", { status: "ON", ts: Date.now() });
        publish(testClient, THERMOSTAT, "cmd/ack", {
          commandId,
          status: "SUCCEEDED",
          ts: Date.now(),
          deviceId: "thermostat-01",
        });
        resolvePromise();
      };
      testClient.on("message", onMessage);
    });
    await new Promise<void>((resolvePromise, reject) => {
      testClient.subscribe(cmdTopic, { qos: 1 }, (err) => (err ? reject(err) : resolvePromise()));
    });

    await publishDeviceCommand(testClient, redis, {
      commandId,
      sessionId: "test-session",
      actorType: "USER",
      actorId: null,
      role: "ADMIN",
      targetId: deviceId,
      target: THERMOSTAT,
      command: "query_state",
    });

    await ackSent;

    await waitFor(
      async () => {
        const result = await query<{ status: string }>(
          "SELECT status FROM command WHERE command_id = $1",
          [commandId],
        );
        return result.rows[0]?.status === "SUCCEEDED" ? true : undefined;
      },
      { message: "query_state command가 SUCCEEDED로 종결되지 않았다" },
    );

    const audit = await query<{ execution_status: string }>(
      "SELECT execution_status FROM audit_log WHERE command_id = $1 ORDER BY log_id ASC",
      [commandId],
    );
    const statuses = audit.rows.map((r) => r.execution_status);
    expect(statuses).toEqual(
      expect.arrayContaining(["CREATED", "PENDING", "IN_PROGRESS", "SUCCEEDED"]),
    );
  });
});
