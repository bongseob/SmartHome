/**
 * @smarthome/db — pg Pool + repository 패턴 (ORM 미사용).
 * 마이그레이션은 node-pg-migrate (migrations/*.sql, PROJECT_RULES §11).
 * TODO: 도메인별 repository 구현.
 */
export * from "./pool.js";

/** 명령 상태전이 + audit_log 는 반드시 동일 트랜잭션(withTransaction)으로 기록한다. */
export const AUDIT_REQUIRED_IN_TX = true as const;
