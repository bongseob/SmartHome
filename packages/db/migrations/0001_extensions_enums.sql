-- Up Migration
-- 확장 + 도메인 enum 타입 (docs/erd.md §4, packages/contracts/src/enums.ts와 일치)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE device_category AS ENUM ('DEVICE','SENSOR','GATEWAY','CAMERA');
CREATE TYPE device_status AS ENUM ('ON','OFF','WARNING','ALARM','OFFLINE');
CREATE TYPE device_lifecycle AS ENUM ('REGISTERED','PROVISIONED','COMMISSIONED','ACTIVE','MAINTENANCE','DECOMMISSIONED');
CREATE TYPE camera_protocol AS ENUM ('RTSP','WEBRTC','HLS','ONVIF');
CREATE TYPE actor_type AS ENUM ('ADMIN','USER','AI','SYSTEM');
CREATE TYPE target_type AS ENUM ('DEVICE','GROUP','AREA');
CREATE TYPE execution_status AS ENUM ('CREATED','PENDING','IN_PROGRESS','SUCCEEDED','FAILED','TIMED_OUT');
CREATE TYPE ack_status AS ENUM ('IN_PROGRESS','SUCCEEDED','FAILED');
CREATE TYPE app_role AS ENUM ('ADMIN','USER','MONITOR','HITL_APPROVER');
CREATE TYPE access_level AS ENUM ('VIEW','CONTROL','MANAGE');
CREATE TYPE alarm_tier AS ENUM ('REACTIVE','PROACTIVE','OPTIMIZATION');
CREATE TYPE severity AS ENUM ('INFO','WARNING','CRITICAL');
CREATE TYPE alarm_state AS ENUM ('RAISED','ACK','SNOOZED','RESOLVED');
CREATE TYPE alarm_action_type AS ENUM ('ACK','SNOOZE','RESOLVE','NOTE');
CREATE TYPE channel_type AS ENUM ('PUSH','EMAIL','SMS','WEBHOOK');
CREATE TYPE schedule_type AS ENUM ('ONE_TIME','DAILY','WEEKLY','MONTHLY','CRON','EVENT');
CREATE TYPE schedule_run_status AS ENUM ('FIRED','SKIPPED','FAILED');
CREATE TYPE recommendation_type AS ENUM ('ANOMALY','ENERGY','AWAY','SLEEP','RISK');
CREATE TYPE recommendation_status AS ENUM ('PENDING_APPROVAL','APPROVED','REJECTED','EXECUTED','EXPIRED');
CREATE TYPE hitl_decision_value AS ENUM ('APPROVE','REJECT');
CREATE TYPE credential_type AS ENUM ('MQTT_PASSWORD','CLIENT_CERT');
CREATE TYPE ota_job_status AS ENUM ('CREATED','RUNNING','PAUSED','COMPLETED','ABORTED');
CREATE TYPE ota_strategy AS ENUM ('ALL_AT_ONCE','CANARY','STAGED');
CREATE TYPE ota_status AS ENUM ('PENDING','DOWNLOADING','VERIFYING','APPLYING','SUCCESS','FAILED','ROLLED_BACK');

-- Down Migration
DROP TYPE IF EXISTS ota_status, ota_strategy, ota_job_status, credential_type, hitl_decision_value,
  recommendation_status, recommendation_type, schedule_run_status, schedule_type, channel_type,
  alarm_action_type, alarm_state, severity, alarm_tier, access_level, app_role, ack_status,
  execution_status, target_type, actor_type, camera_protocol, device_lifecycle, device_status,
  device_category;
