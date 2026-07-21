-- Up Migration
-- camera.onvif_password는 이제 애플리케이션 계층(AES-256-GCM, CAMERA_CREDENTIAL_KEY)에서
-- 암호화한 뒤 저장한다(코드 리뷰 P2 #17, packages/db/src/camera-repository.ts). SQL 마이그레이션
-- 만으로는 Node 암호화 로직을 실행할 수 없어 기존에 평문으로 들어가 있던 값을 그 자리에서
-- 재암호화할 수 없다 — 안전하게 NULL로 비워 강제로 재등록하게 한다(현재 이 값을 쓰는 실카메라는
-- 없고, 개발용 더미 값만 있었다).
UPDATE camera SET onvif_password = NULL WHERE onvif_password IS NOT NULL;

-- Down Migration
-- 평문으로 되돌릴 수 없다(이미 NULL로 비웠음) — down 없음.
