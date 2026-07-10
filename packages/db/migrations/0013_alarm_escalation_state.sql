-- Up Migration
-- M9 Alarm Service: 알람별 에스컬레이션 진행 레벨 추적(중복 알림 방지). 0002 사건 이후
-- 기존 마이그레이션(0006_alarm.sql)을 고치는 대신 새 파일로 추가한다(PROJECT_RULES §11).
ALTER TABLE alarm_log ADD COLUMN escalated_level integer NOT NULL DEFAULT 0;

-- Down Migration
ALTER TABLE alarm_log DROP COLUMN IF EXISTS escalated_level;
