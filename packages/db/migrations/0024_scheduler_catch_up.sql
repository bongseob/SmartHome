-- Up Migration
-- 스케줄러 다운타임 캐치업 옵트인(SRS 3.4, 안전 정책 — 2026-07-14 사용자 결정).
-- 기본값(false)은 리눅스 cron과 동일하게 동작: 폴링 주기(15초)의 정상 지연만 흡수하고(1분),
-- 실제 다운타임 동안 놓친 발화는 뒤늦게 실행하지 않는다(SKIPPED). true로 켠 스케줄만
-- 10분 유예(EXTENDED_GRACE_MINUTES)까지 늦더라도 재기동 시 발화한다 — 사람이 "이미 실행됐거나
-- 아예 실행 안 됐겠지"라고 가정하는 시점에 장비가 예기치 않게 상태를 바꾸는 위험을 피하기 위해
-- 기본은 꺼둔다(고위험 여부와 무관하게 전체 기본값).
ALTER TABLE scheduler
  ADD COLUMN catch_up_enabled boolean NOT NULL DEFAULT false;

-- Down Migration
ALTER TABLE scheduler DROP COLUMN catch_up_enabled;
