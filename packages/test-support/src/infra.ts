import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";

/**
 * 통합 테스트 전용 Mosquitto 설정. `allow_anonymous true`는 이 1회성·격리된 컨테이너에서만
 * 쓰인다 — 프로덕션 auth(보드별 계정/ACL, docs/tls-deployment.md)와는 무관하다.
 */
const TEST_MOSQUITTO_CONF = "listener 1883\nallow_anonymous true\n";

export interface TestInfra {
  databaseUrl: string;
  redisUrl: string;
  mqttUrl: string;
  stop(): Promise<void>;
}

async function startPostgres(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer("postgres:15").withDatabase("smarthome").start();
}

async function startRedis(): Promise<StartedRedisContainer> {
  return new RedisContainer("redis:7-alpine").start();
}

async function startMosquitto(): Promise<StartedTestContainer> {
  return new GenericContainer("eclipse-mosquitto:2")
    .withExposedPorts(1883)
    .withCopyContentToContainer([
      { content: TEST_MOSQUITTO_CONF, target: "/mosquitto/config/mosquitto.conf" },
    ])
    .withWaitStrategy(Wait.forLogMessage(/mosquitto version .* running/i))
    .start();
}

/** Postgres+Redis+Mosquitto를 병렬 기동하고 접속 URL을 반환한다. */
export async function startTestInfra(): Promise<TestInfra> {
  const [postgres, redis, mosquitto] = await Promise.all([
    startPostgres(),
    startRedis(),
    startMosquitto(),
  ]);

  const mqttUrl = `mqtt://${mosquitto.getHost()}:${mosquitto.getMappedPort(1883)}`;

  return {
    databaseUrl: postgres.getConnectionUri(),
    redisUrl: redis.getConnectionUrl(),
    mqttUrl,
    async stop(): Promise<void> {
      await Promise.all([postgres.stop(), redis.stop(), mosquitto.stop()]);
    },
  };
}
