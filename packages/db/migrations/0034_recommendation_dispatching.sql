-- Up Migration
-- retryDispatch() 동시 요청이 같은 DISPATCH_FAILED 추천을 동시에 재발행할 수 있었다(코드 리뷰
-- P1-4) — 상태 확인(check)과 실제 발행(act) 사이에 원자적 claim이 없어 두 요청 모두 통과해
-- 서로 다른 commandId로 동일 제어를 중복 발행할 수 있었다. scheduler의 claimIfDue() 패턴처럼
-- "DISPATCHING" claim 상태를 두고, 조건부 UPDATE...WHERE status='DISPATCH_FAILED' RETURNING으로
-- 한 요청만 claim하게 한다(apps/scheduler/src/index.ts의 FOR UPDATE 선점 claim과 동일 원칙,
-- 여기서는 단일 UPDATE로 더 가볍게 구현). claimed_at은 발행 도중 프로세스가 죽어 DISPATCHING에
-- 영구 고착되는 것을 막는 회수 유예(claimIfDue 옆의 STALE_FIRED_RUN_MS와 동일한 관례) 판단에 쓴다.
ALTER TYPE recommendation_status ADD VALUE 'DISPATCHING';
ALTER TABLE ai_recommendation ADD COLUMN claimed_at timestamptz;

-- Down Migration
-- Postgres는 enum에서 값을 제거하는 기능이 없다(ALTER TYPE ... DROP VALUE 없음) — 컬럼이
-- 이 값을 참조 중이면 타입 자체를 재생성해야 하므로, 이 마이그레이션은 down이 없다.
