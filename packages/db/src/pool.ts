import pg from "pg";

const { Pool } = pg;

export type { PoolClient, QueryResult, QueryResultRow } from "pg";

let pool: pg.Pool | undefined;

/** 프로세스 공용 Pool (DATABASE_URL 기반). 최초 호출 시 생성. */
export function getPool(connectionString: string | undefined = process.env.DATABASE_URL): pg.Pool {
  if (!pool) {
    if (!connectionString) {
      throw new Error("DATABASE_URL 미설정 — .env 를 확인하세요");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params as unknown[]);
}

/**
 * 트랜잭션 헬퍼. 명령 상태전이 + audit_log 기록을 동일 트랜잭션으로 묶는 데 사용한다
 * (PROJECT_RULES §4.3 — 기록 없는 제어 = 버그).
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
