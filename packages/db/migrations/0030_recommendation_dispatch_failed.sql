-- Up Migration
-- HITL 승인 후 실제 제어(MQTT) 발행이 실패하면 예전엔 APPROVED에 영구히 멈춰 재승인도
-- 재시도도 못 했다(코드 리뷰 P1 #4). 새 상태를 추가해 운영자가 재시도로 EXECUTED까지
-- 복구시킬 수 있게 한다(apps/api RecommendationsService.retryDispatch).
ALTER TYPE recommendation_status ADD VALUE 'DISPATCH_FAILED';

-- Down Migration
-- Postgres는 enum에서 값을 제거하는 기능이 없다(ALTER TYPE ... DROP VALUE 없음) — 컬럼이
-- 이 값을 참조 중이면 타입 자체를 재생성해야 하므로, 이 마이그레이션은 down이 없다.
