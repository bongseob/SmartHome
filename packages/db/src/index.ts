/**
 * @smarthome/db — pg Pool + repository 패턴 (ORM 미사용).
 * 마이그레이션은 node-pg-migrate (docs/architecture.md §10, PROJECT_RULES §11).
 * TODO: pg.Pool 초기화, 트랜잭션 헬퍼, repository 구현, migrations/.
 */
export interface DbConfig {
  connectionString: string;
  /** 명령 상태전이 + audit_log 는 동일 트랜잭션으로 기록(기록 없는 제어 금지) */
  readonly requireAuditInTx: true;
}

export const DEFAULT_DB_CONFIG: Pick<DbConfig, "requireAuditInTx"> = {
  requireAuditInTx: true,
};
