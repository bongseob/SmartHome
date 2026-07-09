# SmartHome — 지능형 IoT 및 스마트홈 관제 시스템

MQTT(Mosquitto) / UNS 기반 IoT·스마트홈 통합 관제 플랫폼. **pnpm + Turborepo** 모노레포.

## 문서

- 요구사항: [iot_smarthome_srs.md](iot_smarthome_srs.md)
- 구현 규칙: [PROJECT_RULES.md](PROJECT_RULES.md) · 에이전트 지시: [AGENTS.md](AGENTS.md)
- 설계 산출물: [docs/](docs/) (ERD · MQTT Topic · REST API · 아키텍처 · 시퀀스 · UI/UX · 시뮬레이터 · 테스트 · 수명주기/OTA)

## 구조

```
packages/
  contracts/   enum · UNS buildTopic · MQTT payload 스키마 · 명령 수명주기 (단일 소스)
  mqtt/        mqtt.js 래퍼 (QoS/LWT/공유구독)              [스캐폴딩]
  db/          pg + repository (ORM 미사용) + node-pg-migrate [스캐폴딩]
  auth/        JWT 발급/검증 + RBAC 가드                     [스캐폴딩]
apps/
  api/         REST + WebSocket                              [스캐폴딩]
  gateway/     MQTT ingest/command/ack/LWT/alarm             [스캐폴딩]
  scheduler/   cron/event → 명령 발행                        [스캐폴딩]
  ai-engine/   추천 + HITL 게이트                            [스캐폴딩]
  media-gateway/ PTZ 카메라 영상 중계 (옵션)                 [스캐폴딩]
  device-simulator/ 가상 기기 (개발용)                       [스캐폴딩]
  web/         React + Konva 대시보드                        [스캐폴딩]
```

## 개발

```bash
corepack enable pnpm      # Node 20+ 동봉
pnpm install
cp .env.example .env      # DATABASE_URL / MQTT_URL 설정

# 인프라: PostgreSQL(기존 :5432, DB=smarthome) + Mosquitto
docker compose -f infra/docker-compose.dev.yml up -d
pnpm --filter @smarthome/db migrate:up   # ERD 스키마 적용

pnpm build                # turbo: contracts 먼저 → 나머지
pnpm test                 # 단위 테스트
pnpm typecheck

# 가상 기기 M1 (실기기 없이 데이터 흐름 확인)
SIM_RUN_MS=8000 pnpm --filter @smarthome/device-simulator start
```

현재 상태:
- ✅ `@smarthome/contracts`(단일 소스) · `@smarthome/db`(35테이블 마이그레이션) ·
  `@smarthome/mqtt`(mqtt.js 래퍼) · `device-simulator` M1(connect+LWT+state+telemetry)
- 🟡 나머지 앱은 스캐폴딩 스텁

다음 구현 순서는 각 문서의 "미해결/후속"과 [docs/test-strategy.md](docs/test-strategy.md) 마일스톤 참고.
