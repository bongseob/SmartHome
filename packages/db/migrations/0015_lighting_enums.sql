-- Up Migration
-- 조명/부하 제어 도메인 enum (docs/srs-lighting-control-addendum.md §3.2·§7·§2.3).
-- packages/contracts/src/enums.ts(LoadClass·LunarSolar·AreaKind)와 일치. 단일 소스 원칙(PROJECT_RULES §1·§11).
CREATE TYPE load_class AS ENUM ('NORMAL', 'EMERGENCY', 'RESERVE');
CREATE TYPE lunar_solar AS ENUM ('SOLAR', 'LUNAR');
CREATE TYPE area_kind AS ENUM ('ROOM', 'PANEL');

-- Down Migration
DROP TYPE IF EXISTS area_kind;
DROP TYPE IF EXISTS lunar_solar;
DROP TYPE IF EXISTS load_class;
