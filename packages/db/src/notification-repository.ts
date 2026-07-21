import type { NotificationDeliveryStatus } from "@smarthome/contracts";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";

/**
 * 알림 발송 실패 추적(코드 리뷰 P1 #11). dispatchNotification()이 즉시 재시도까지
 * 실패한 건만 여기 남는다 — 성공한 발송은 기록하지 않는다(발송 로그가 아니라 "확인이
 * 필요한 실패"만 추적하는 테이블).
 */
export interface NotificationDeliveryPayload {
  alarmId: string;
  tier: string;
  severity: string;
  message: string | null;
  deviceId: string | null;
  escalationLevel: number;
  ts: number;
}

export interface NotificationDeliveryRecord {
  id: string;
  alarmId: string;
  channelId: string;
  status: NotificationDeliveryStatus;
  payload: NotificationDeliveryPayload;
  attemptCount: number;
  lastError: string | null;
}

interface NotificationDeliveryRow extends QueryResultRow {
  id: string;
  alarm_id: string;
  channel_id: string;
  status: NotificationDeliveryStatus;
  payload: NotificationDeliveryPayload;
  attempt_count: number;
  last_error: string | null;
}

function toRecord(row: NotificationDeliveryRow): NotificationDeliveryRecord {
  return {
    id: row.id,
    alarmId: row.alarm_id,
    channelId: row.channel_id,
    status: row.status,
    payload: row.payload,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
  };
}

// 배경 재시도 백오프 일정 — 총 5회, 약 1시간 40분에 걸쳐 재시도 후 포기한다.
const BACKOFF_SCHEDULE_SEC = [60, 300, 900, 1800, 3600];
const MAX_ATTEMPTS = BACKOFF_SCHEDULE_SEC.length + 1; // +1은 최초(동기) 시도

function nextBackoffSeconds(attemptCount: number): number {
  const idx = Math.min(attemptCount - 1, BACKOFF_SCHEDULE_SEC.length - 1);
  return BACKOFF_SCHEDULE_SEC[idx]!;
}

/** dispatchNotification이 동기 재시도까지 실패했을 때 배경 재시도 대상으로 기록한다. */
export async function recordFailedDelivery(
  db: QueryExecutor,
  input: {
    alarmId: string;
    channelId: string;
    payload: NotificationDeliveryPayload;
    attemptCount: number;
    error: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO notification_delivery (alarm_id, channel_id, status, payload, attempt_count, next_retry_at, last_error)
     VALUES ($1,$2,'PENDING',$3,$4, now() + ($5 || ' seconds')::interval, $6)`,
    [
      input.alarmId,
      input.channelId,
      JSON.stringify(input.payload),
      input.attemptCount,
      nextBackoffSeconds(input.attemptCount),
      input.error,
    ],
  );
}

/** 지금 재시도할 시점이 된 PENDING 건들. */
export async function listDueNotificationRetries(db: QueryExecutor): Promise<NotificationDeliveryRecord[]> {
  const r = await db.query<NotificationDeliveryRow>(
    `SELECT id::text, alarm_id::text, channel_id::text, status, payload, attempt_count, last_error
     FROM notification_delivery
     WHERE status = 'PENDING' AND next_retry_at <= now()
     ORDER BY next_retry_at
     LIMIT 100`,
  );
  return r.rows.map(toRecord);
}

export async function markNotificationDelivered(db: QueryExecutor, id: string): Promise<void> {
  await db.query(
    `UPDATE notification_delivery SET status = 'DELIVERED', next_retry_at = NULL, updated_at = now() WHERE id::text = $1`,
    [id],
  );
}

/** 재시도 한도 내면 다음 백오프로 미루고, 초과하면 FAILED_PERMANENT로 확정한다. */
export async function markNotificationRetryOrFailed(
  db: QueryExecutor,
  input: { id: string; attemptCount: number; error: string },
): Promise<void> {
  if (input.attemptCount >= MAX_ATTEMPTS) {
    await db.query(
      `UPDATE notification_delivery
       SET status = 'FAILED_PERMANENT', attempt_count = $2, last_error = $3, next_retry_at = NULL, updated_at = now()
       WHERE id::text = $1`,
      [input.id, input.attemptCount, input.error],
    );
    return;
  }
  await db.query(
    `UPDATE notification_delivery
     SET attempt_count = $2, last_error = $3, next_retry_at = now() + ($4 || ' seconds')::interval, updated_at = now()
     WHERE id::text = $1`,
    [input.id, input.attemptCount, input.error, nextBackoffSeconds(input.attemptCount)],
  );
}
