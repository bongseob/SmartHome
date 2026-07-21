-- Up Migration
-- 알림 발송 결과 추적 (코드 리뷰 P1 #11 — webhook 실패가 로그만 남기고 조용히 사라지던 문제).
-- dispatchNotification()이 즉시 재시도까지 실패하면 이 테이블에 PENDING으로 기록하고,
-- apps/gateway의 배경 재시도 sweep이 지수 백오프로 재시도한다(새 워커 프로세스 없음 —
-- 기존 alarm escalation sweep과 같은 setInterval 폴링 패턴 재사용). 한도 초과 시
-- FAILED_PERMANENT로 남아 운영자가 조회할 수 있다(별도 DLQ 테이블 없이 status로 충분).
CREATE TYPE notification_delivery_status AS ENUM ('PENDING','DELIVERED','FAILED_PERMANENT');

CREATE TABLE notification_delivery (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alarm_id      bigint NOT NULL REFERENCES alarm_log(id) ON DELETE CASCADE,
  channel_id    uuid NOT NULL REFERENCES notification_channel(id) ON DELETE CASCADE,
  status        notification_delivery_status NOT NULL DEFAULT 'PENDING',
  -- 재시도 시점에 alarm_log를 다시 join하지 않고 최초 발송 시도 당시 내용 그대로 재전송한다.
  payload       jsonb NOT NULL,
  attempt_count integer NOT NULL DEFAULT 1,
  next_retry_at timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 배경 sweep이 매번 "지금 재시도할 것"만 빠르게 찾도록.
CREATE INDEX idx_notification_delivery_due ON notification_delivery(next_retry_at)
  WHERE status = 'PENDING';

-- Down Migration
DROP TABLE IF EXISTS notification_delivery;
DROP TYPE IF EXISTS notification_delivery_status;
