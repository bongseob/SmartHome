-- Up Migration
-- ONVIF 카메라 인증 정보(architecture.md §5-cam, gateway 카메라 어댑터가 PTZ 호출 시 사용).
-- 다른 device_credential(플랫폼이 기기 인증을 검증하는 용도, secret_hash)과는 방향이 반대다 —
-- 여기는 게이트웨이가 "카메라 쪽"에 로그인하기 위한 자격이라 원문 보관이 불가피하다(알려진 단순화,
-- 이 프로젝트에 아직 비밀관리 인프라가 없음 — .env의 MQTT_PASSWORD와 동일한 수준).
ALTER TABLE camera
  ADD COLUMN onvif_username text,
  ADD COLUMN onvif_password text;

-- Down Migration
ALTER TABLE camera
  DROP COLUMN IF EXISTS onvif_password,
  DROP COLUMN IF EXISTS onvif_username;
