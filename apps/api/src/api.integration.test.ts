import "reflect-metadata"; // apps/api/src/index.ts에서만 로드하던 폴리필 — app.module.js를 직접
// import하는 이 테스트에서도 필요하다(없으면 Nest DI가 Reflector 등 생성자 인자를 못 채운다).
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { startTestEnvironment, type TestInfra } from "@smarthome/test-support";
import { closePool, query } from "@smarthome/db";
import { connect, topicFor, type DeviceIdentity, type MqttClient } from "@smarthome/mqtt";

/**
 * api↔DB 통합 테스트 (docs/test-strategy.md §2). `apps/api/src/modules/app.module.ts`는
 * 부작용 없는 순수 NestJS 모듈이라 `@nestjs/testing`으로 in-process 부트스트랩한다
 * (apps/api/src/index.ts의 최상위 자동실행 `main()`은 사용하지 않는다).
 * 명령 발행의 device ack 왕복(gateway 쪽)은 gateway.integration.test.ts가 이미 검증하므로
 * 여기서는 "api가 실제로 MQTT에 올바르게 발행했는가"까지만 확인한다.
 */

let infra: TestInfra;
let app: INestApplication;

beforeAll(async () => {
  infra = await startTestEnvironment();
  process.env.DATABASE_URL = infra.databaseUrl;
  process.env.REDIS_URL = infra.redisUrl;
  process.env.MQTT_URL = infra.mqttUrl;
  process.env.AUTH_JWT_SECRET = "integration-test-secret-at-least-32-characters";

  const { AppModule } = await import("./modules/app.module.js");
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
}, 60_000);

afterAll(async () => {
  await app?.close();
  await closePool();
  await infra?.stop();
});

async function loginAsAdmin(): Promise<string> {
  const res = await supertest(app.getHttpServer())
    .post("/api/v1/auth/login")
    .send({ username: "admin", password: "admin1234" });
  expect(res.status).toBe(201); // Nest 기본 POST 상태코드(login에 @HttpCode 오버라이드 없음)
  return res.body.accessToken as string;
}

describe("api 통합 — Auth", () => {
  it("정상 로그인은 201 + audit_log SUCCEEDED를 남긴다", async () => {
    const res = await supertest(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ username: "admin", password: "admin1234" });

    expect(res.status).toBe(201); // Nest 기본 POST 상태코드(login에 @HttpCode 오버라이드 없음)
    expect(typeof res.body.accessToken).toBe("string");

    const audit = await query<{ execution_status: string }>(
      `SELECT execution_status FROM audit_log
       WHERE command = 'LOGIN' AND execution_status = 'SUCCEEDED'
       ORDER BY log_id DESC LIMIT 1`,
    );
    expect(audit.rows[0]?.execution_status).toBe("SUCCEEDED");
  });

  it("오답 비밀번호는 401 + audit_log FAILED를 남긴다", async () => {
    const res = await supertest(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ username: "admin", password: "wrong-password" });

    expect(res.status).toBe(401);

    const audit = await query<{ execution_status: string }>(
      `SELECT execution_status FROM audit_log
       WHERE command = 'LOGIN' AND execution_status = 'FAILED'
       ORDER BY log_id DESC LIMIT 1`,
    );
    expect(audit.rows[0]?.execution_status).toBe("FAILED");
  });
});

describe("api 통합 — 명령 발행 경로", () => {
  const identity: DeviceIdentity = {
    site: "site1",
    building: "bldg-a",
    floor: "2f",
    area: "living-room",
    device: "thermostat-01",
  };
  let mqttSpy: MqttClient;

  beforeAll(async () => {
    mqttSpy = connect(infra.mqttUrl, { clientId: "test:api-integration-spy" });
    await new Promise<void>((resolvePromise, reject) => {
      mqttSpy.on("connect", () => resolvePromise());
      mqttSpy.on("error", reject);
    });
  });

  afterAll(() => {
    mqttSpy?.end(true);
  });

  it("POST /commands가 command/audit_log에 반영되고 실제 MQTT cmd를 QoS1로 발행한다", async () => {
    const accessToken = await loginAsAdmin();
    const deviceRow = await query<{ id: string }>("SELECT id FROM device WHERE code = $1", [
      "thermostat-01",
    ]);
    const deviceId = deviceRow.rows[0]?.id;
    if (!deviceId) throw new Error("시드에 thermostat-01이 없다");

    const cmdTopic = topicFor(identity, "cmd");
    const received = new Promise<{ command: string; qos: number }>((resolvePromise) => {
      mqttSpy.on("message", (topic: string, payload: Buffer, packet: { qos: 0 | 1 | 2 }) => {
        if (topic !== cmdTopic) return;
        const parsed = JSON.parse(payload.toString()) as { command: string };
        resolvePromise({ command: parsed.command, qos: packet.qos });
      });
    });
    await new Promise<void>((resolvePromise, reject) => {
      mqttSpy.subscribe(cmdTopic, { qos: 1 }, (err) => (err ? reject(err) : resolvePromise()));
    });

    const res = await supertest(app.getHttpServer())
      .post("/api/v1/commands")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ command: "turn_on", target: { id: deviceId } });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("IN_PROGRESS");

    const message = await received;
    expect(message.command).toBe("turn_on");
    expect(message.qos).toBe(1); // QOS_BY_SUFFIX["cmd"] === 1, PROJECT_RULES §3

    const commandRow = await query<{ status: string }>(
      "SELECT status FROM command WHERE command_id = $1",
      [res.body.commandId],
    );
    expect(commandRow.rows[0]?.status).toBe("IN_PROGRESS");

    const audit = await query<{ execution_status: string }>(
      "SELECT execution_status FROM audit_log WHERE command_id = $1 ORDER BY log_id ASC",
      [res.body.commandId],
    );
    const statuses = audit.rows.map((row) => row.execution_status);
    expect(statuses).toEqual(
      expect.arrayContaining(["CREATED", "PENDING", "IN_PROGRESS"]),
    );
  });
});
