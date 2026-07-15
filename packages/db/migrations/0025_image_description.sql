-- Up Migration
-- 이미지 라이브러리 부연 설명 — 이름과 별개로 "이 이미지가 어떤 용도로 쓰이는지"를 관리자가
-- 남겨두는 메타 정보. area 배경 외에 다른 것의 배경으로도 재사용될 수 있으므로(2026-07-15),
-- 용도 파악을 돕는 자유 텍스트 필드다.
ALTER TABLE image
  ADD COLUMN description text;

-- Down Migration
ALTER TABLE image
  DROP COLUMN IF EXISTS description;
