---
name: run-local
description: Launch and drive the SmartHome monorepo locally — bring up infra (PostgreSQL·Mosquitto·Redis), run migrations + seed, start API·Gateway·Web, and verify the full stack end-to-end (login → dashboard). Use whenever asked to run, start, boot, or smoke-test the app locally.
---

# SmartHome 로컬 실행

모노레포(pnpm + Turborepo)를 로컬에서 **띄우고 실제로 구동 확인**하는 검증된 절차.
2026-07-11 실측으로 통과함. 근거: [README.md](../../../README.md) "개발" 절, [CLAUDE.md](../../../CLAUDE.md) 고정 결정.

## 이 스킬을 쓰는 때
- "프로젝트 실행", "앱 띄워줘", "구동 확인", "로컬에서 돌려줘" 요청
- 변경 후 전체 스택이 실제로 뜨는지 스모크 테스트할 때

## 아키텍처 한눈에
- 인프라: PostgreSQL(:5432, DB `smarthome`) · Mosquitto(:1883, WS :9001) · Redis(:6379)
- 앱: `@smarthome/api` NestJS(:3000, WS `/ws/realtime`) · `@smarthome/gateway`(MQTT 공유구독) · `@smarthome/web` Vite/React+Konva(:5173)
- 접속정보는 루트 `.env` (`DATABASE_URL` / `MQTT_URL` / `REDIS_URL`)에서 읽음. 앱은 모두 `dotenv -e ../../.env`로 로드.

## 절차

### 1) 인프라 기동

Mosquitto·Redis는 compose로:
```bash
docker compose -f infra/docker-compose.dev.yml up -d
```

**Mosquitto는 인증을 요구한다(`allow_anonymous false`, PROJECT_RULES §5).** `infra/mosquitto/passwd`·
`acl`은 `.gitignore` 대상이라 새로 clone하면 없다 — 최초 1회, DB 마이그레이션/시드 이후에:
```bash
touch infra/mosquitto/passwd infra/mosquitto/acl   # 파일이 없으면 mosquitto가 시작을 못 할 수 있어 먼저 생성
docker compose -f infra/docker-compose.dev.yml up -d mosquitto   # 방금 만든 :ro→읽기쓰기 마운트로 재기동
pnpm --filter @smarthome/db run provision:mqtt-auth   # 서비스 공용 계정(.env에 자동 기록) + 보드별 계정 발급
docker restart mosquitto   # passwd/acl을 확실히 다시 읽게 재기동
```
`provision:mqtt-auth`가 `.env`에 `MQTT_USERNAME=svc-backend`/`MQTT_PASSWORD=...`를 자동으로 추가한다 —
api/gateway/scheduler/device-simulator는 `@smarthome/mqtt`의 `connect()`가 이 값을 자동으로 실어준다.

**주의 — Postgres는 compose에 없다.** compose는 "기존 Postgres 컨테이너(:5432, DB `smarthome`)"를
전제한다. 실행 중인 게 없으면 `.env`의 `DATABASE_URL`(기본 `stock_user`/`stock_pass`/`smarthome`)에
맞춰 직접 띄운다. TimescaleDB는 선택이라 플레인 `postgres:15`로 마이그레이션이 통과한다:
```bash
docker run -d --name smarthome-postgres \
  -e POSTGRES_USER=stock_user -e POSTGRES_PASSWORD=stock_pass -e POSTGRES_DB=smarthome \
  -p 5432:5432 postgres:15
```
> 이미 5432에 Postgres가 있으면 이 단계는 건너뛴다. `lsof -iTCP:5432 -sTCP:LISTEN`로 확인.

Postgres 준비 대기:
```bash
for i in $(seq 1 30); do docker exec smarthome-postgres pg_isready -U stock_user -d smarthome && break; sleep 1; done
```

### 2) 빌드 (contracts 먼저 → 나머지, turbo가 순서 보장)
```bash
pnpm build
```

### 3) 스키마 + 시드
```bash
pnpm --filter @smarthome/db migrate:up   # 마이그레이션 14개
pnpm --filter @smarthome/db seed          # floor·거실/침실 area·기기 3개·admin 생성
```
시드 계정: **`admin` / `admin1234`** (ADMIN 롤).

### 4) 앱 기동 (각각 백그라운드)
```bash
pnpm --filter @smarthome/api start        # NestJS :3000
pnpm --filter @smarthome/gateway start    # MQTT ingest/command
pnpm --filter @smarthome/web dev          # Vite :5173
```

## 구동 확인 (띄우기만 하지 말고 실제로 몰아볼 것)

1. API 헬스: `curl -s http://localhost:3000/health` → `{"status":"ok","service":"api"}`
2. Gateway 로그에 `mqtt://localhost:1883 연결 — 공유구독 시작` 있는지.
3. Web을 브라우저로 몰아본다(Playwright): `http://localhost:5173` →
   `admin` / `admin1234` 로그인 → 대시보드 진입 → Konva 도면에 지역 2개(거실·침실)와
   기기 마커 3개가 렌더링되는지 **스크린샷으로 확인**. 빈 화면이면 기동 실패다.
   - 도면 배경의 `800×600` 플레이스홀더는 정상(실제 도면 이미지 미업로드 시 표시).
   - `favicon.ico` 404 콘솔 에러는 무해.

## 정리(종료)
```bash
# 앱: 백그라운드 프로세스 종료
docker compose -f infra/docker-compose.dev.yml down
docker rm -f smarthome-postgres            # 이 스킬이 띄운 경우만
```

## 함정
- Postgres를 compose에서 찾지 말 것 — 없다. 위 `docker run`으로 별도 기동.
- API는 `dist/`에서 실행(`node dist/index.js`)하므로 코드 변경 후 반드시 `pnpm build` 재실행.
- `.env`에 `MQTT_USERNAME`/`MQTT_PASSWORD`가 없으면 모든 백엔드 프로세스가 mosquitto에
  `not authorised`로 거부된다 — `provision:mqtt-auth`를 먼저 돌렸는지 확인할 것.
- 스크린샷·`.playwright-mcp` 등 QA 아티팩트가 리포지토리 루트에 생기면 커밋 전에 지울 것.
