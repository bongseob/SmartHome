-- Up Migration
-- 동시에 같은 policy+device로 threshold를 위반하는 telemetry가 여러 gateway 인스턴스(또는
-- 겹치는 처리)에서 거의 동시에 들어오면, findOpenAlarm(SELECT)이 둘 다 "열린 알람 없음"으로
-- 보고 둘 다 insertAlarmLog를 실행해 같은 policy+device로 중복 알람이 생길 수 있었다
-- (코드 리뷰 P1 #13). "정책+기기당 열린(RAISED/ACK/SNOOZED) 알람은 최대 1개"를 DB 제약으로
-- 강제한다 — packages/db/src/alarm-service.ts의 raiseAlarmFromPolicyInTx가 unique_violation을
-- 잡아 findOpenAlarm으로 다시 조회하는 방식으로 이 제약과 짝을 이룬다. policy_id/device_id가
-- NULL인 행은 Postgres 관례상 유니크 판정에서 서로 다른 값 취급이라 이 인덱스로 보호되지
-- 않지만, raiseAlarmFromPolicy 경로는 항상 둘 다 채워서 호출한다.
CREATE UNIQUE INDEX idx_alarm_log_open_unique ON alarm_log(policy_id, device_id)
  WHERE state IN ('RAISED','ACK','SNOOZED');

-- Down Migration
DROP INDEX IF EXISTS idx_alarm_log_open_unique;
