# 인수인계 (Handover)

**작성 2026-07-12 · 대상: 다음 에이전트(Gemini 등)가 이어서 작업할 때 먼저 읽는 문서.**

이 파일은 "지금 어디까지 됐고, 무엇을 지켜야 하고, 어떻게 실행하는지"를 한 장으로 정리한다.
세부 규칙/설계는 각 원본 문서를 가리킨다.

---

## 0. 먼저 읽을 것 (순서대로)

1. [AGENTS.md](../AGENTS.md) / [CLAUDE.md](../CLAUDE.md) — 에이전트 작업 규칙(동일 내용). **작업 전 필독.**
2. [PROJECT_RULES.md](../PROJECT_RULES.md) — 반드시 지킬 기술/운영 규칙(§ 참조 많음).
3. [iot_smarthome_srs.md](../iot_smarthome_srs.md) — 요구사항 원본(SRS).
4. [docs/srs-lighting-control-addendum.md](srs-lighting-control-addendum.md) — 조명/부하 제어 도메인 부속 요구사항(최근 작업의 기준).
5. [docs/README.md](README.md) — 전체 산출물 목록. [docs/erd.md](erd.md)·[docs/mqtt-topic-design.md](mqtt-topic-design.md)·[docs/api-spec.md](api-spec.md) 등.

---

## 1. 절대 지킬 규칙 (위반 = 버그, PROJECT_RULES 발췌)

- **도메인 enum은 `packages/contracts`에서만 정의**한다. DB enum·API·프론트가 모두 여기서 import. 문자열 리터럴 중복 금지.
- **DB 스키마 변경은 node-pg-migrate 마이그레이션 파일로만**(`packages/db/migrations/NNNN_*.sql`). 수동 DDL·기존 마이그레이션 수정 금지. **append-only**(다음 번호로 추가).
- **UNS 토픽은 `buildTopic()`(contracts)로만 생성**. 문자열 하드코딩 금지. 계층: `enterprise/{site}/{building}/{floor}/{area}/{device}`.
- **제어 명령은 표준 수명주기 + Audit_Log**: CREATED→PENDING→IN_PROGRESS→SUCCEEDED/FAILED/TIMED_OUT, **모든 상태 전이를 audit_log에 기록**. 발행은 `packages/command-flow`의 `publishDeviceCommand` 단일 소스 재사용.
- **QoS/LWT/Retained**: state=QoS1+Retained, telemetry=QoS0, cmd/ack=QoS1, alarm=QoS2. LWT 필수.
- **관리 변경(휴일·타임프로그램·이미지·area 등)도 audit_log 기록**(target_type을 해당 도메인 문자열로; audit_log.target_type은 text).
- Gateway↔플랫폼은 **MQTT 전용**. 레거시 보드의 직접 TCP는 엣지 브리지로 흡수(개념만, 미구현).

## 2. 아키텍처 한눈에

- 모노레포: **pnpm + Turborepo**. 3단 레이어: `packages/db`(pg repository) → `apps/api`(NestJS service) → controller. 프론트 `apps/web`(React + Konva + ag-grid + echarts).
- 인증: JWT 자체 발급. RBAC(ADMIN/USER/MONITOR/HITL_APPROVER). `RolesGuard`에서 **ADMIN은 자동 통과**(isAdmin).
- 패키지: `contracts`(단일 소스), `db`, `mqtt`, `command-flow`, `auth`, `realtime`, `notify`.
- 앱: `api`, `gateway`, `scheduler`, `ai-engine`, `media-gateway`, `device-simulator`, `web`.

## 3. 실행 방법 (검증됨)

`.claude/skills/run-local/SKILL.md`에 절차가 있다(요약):

```bash
# 인프라: Mosquitto+Redis(compose) + Postgres(compose에 없음 → 직접 컨테이너)
docker compose -f infra/docker-compose.dev.yml up -d
docker run -d --name smarthome-postgres -e POSTGRES_USER=stock_user \
  -e POSTGRES_PASSWORD=stock_pass -e POSTGRES_DB=smarthome -p 5432:5432 postgres:15

pnpm install
pnpm build                                   # turbo: contracts 먼저
pnpm --filter @smarthome/db migrate:up       # 0001~0022
pnpm --filter @smarthome/db seed             # 기본 시드(admin/admin1234)
pnpm --filter @smarthome/db seed:building-sample  # 20층 샘플 데이터(권장)

pnpm --filter @smarthome/api start           # :3000  (dist 실행 → 코드 변경 후 재빌드 필요)
pnpm --filter @smarthome/web dev             # :5173
```

- **로그인**: `admin` / `admin1234`.
- **주의**: Postgres는 compose에 없다. `.env`(DATABASE_URL=stock_user/stock_pass/smarthome)에 맞춰 직접 띄운다. TimescaleDB 없이 plain postgres:15로 마이그레이션 통과.
- 현재 로컬에 이미 인프라·API·Web·샘플데이터(감시장비 76 + 센서 307 등)가 떠 있을 수 있음.

## 4. 도메인 핵심 규칙 (최근 정정 — 반드시 준수)

**차단기(접점)는 전열 / 전등으로 나뉘고, 전등만 비상등 / 일반등으로 구분된다.**
- 비상/일반은 **오직 조명(전등) 차단기의 `load_class`**(EMERGENCY=비상등, NORMAL=일반등)로 판정한다.
  전열·화재감지기 등 비조명은 이 축과 무관(비상 아님). RESERVE=예비(SP).
- 안전 규칙: **전열은 원격 제어하지 않고 상태만 모니터링**. 전등만 제어 가능.
- 화재감지기=비상 같은 휴리스틱은 **금지**(도메인상 틀림). load_class가 유일한 근거.
- 데이터 모델: 감시장비(RMU, device_role=MONITORING_EQUIPMENT) 1대에 여러 접점(센서, device_role=SENSOR, parent_device_id로 소속)이 붙는다. 접점 = channel_address(접점번호)·terminal_block(단자)·sensor_io_type(DI/DO/AI/AO)·load_class.

## 5. 지금까지 한 일 (main 반영 완료)

- **조명/부하 제어 도메인 통합**: 요구사항 부속문서 + 스키마(마이그레이션 0015~0022) + API.
  - 휴일관리(음/양력), 타임프로그램(≤300)+스케줄등록, 이미지 라이브러리+분전반(PANEL area),
    장애이력 조회, 그룹 일괄제어 **순차 1.5초**(system_setting), 기기 운영모델(감시장비/센서),
    그룹 제어, 대시보드.
- **웹 관제(FloorMap)**: 지역 선택 → 감시장비 필터, 호버=일괄상태 툴팁, 클릭=접점별 개별제어 패널.
- **전체 모니터링**: 전열/전등 **층별 요약표**(배경색 구분, 상태등 All ON/All OFF/혼합, ON/OFF/빈 숫자).
  전등 행 클릭→관제 해당 층 이동(개별제어), **전열은 모니터링 전용(클릭 불가)**.
- **관제 도면 cover-fill**: 도면 이미지가 모니터링 영역을 꽉 채움(`fitMapToViewport` cover).

최근 커밋: `git log --oneline -15` 참고. 모두 main에 ff-merge됨.

## 6. 함정 / 알아둘 것

- **zsh 산술 확장 버그**: UUID(하이픈 포함)를 셸 변수로 다루면 `bad math expression` 에러. UUID 다루는 스크립트는 **bash로 실행**하거나 SQL 파일로 분리.
- **시드는 멱등**(ON CONFLICT). `seed:building-sample` 재실행 안전. load_class 등은 시드에서 채운다(전등만).
- **API는 dist 실행**(`node dist/index.js`) → 백엔드 코드 변경 후 반드시 `pnpm build` 재실행·재기동.
- **웹은 Vite HMR** → 저장 시 반영. 단 오래 열린 탭은 토큰 만료로 WS 재연결 에러가 콘솔에 남을 수 있음(새로고침하면 사라짐, dev StrictMode의 WS "closed before established" 경고는 무해).
- **QA 아티팩트(스크린샷·.playwright-mcp)**가 리포지토리 루트에 생기면 커밋 전에 지울 것.

## 7. Git 워크플로우

- 기능마다 **브랜치 → 커밋 → 푸시 → main에 ff-merge → 브랜치 삭제**로 진행함(main 선형 히스토리).
- main은 **보호 안 됨**. 원격은 `github.com:bongseob/SmartHome`.
- 커밋은 검증(build/test/typecheck + 가능하면 브라우저/curl E2E) 후. DB 스키마 변경은 down/up 가역성까지 확인.

## 8. 열린 항목 / 다음 후보

- addendum 후속 산출물 반영: [erd.md](erd.md) 이후 [api-spec.md](api-spec.md)/[openapi.yaml](openapi.yaml)/[ui-ux-design.md](ui-ux-design.md)에 신규 API·화면 문서화가 덜 됨.
- 전체 모니터링의 A-CORE/B-CORE(라이저별 분할)는 데이터에 CORE 개념이 없어 단일 건물 기준으로만 구성됨 — 필요 시 건물/라이저 축 추가.
- 전열/전등 `load_class`는 시드에서만 채워짐(운영 데이터에선 기기관리 화면으로 지정). 실데이터 반영 시 화면 자동 정합.
- 도면 cover-fill은 가장자리 크롭 가능 — "잘림 없이 채우기"가 필요하면 stretch(비균일) 옵션 검토.
- PROJECT_RULES 부록 A.2 열린 항목(Notification provider, MLOps 서빙, K8s/Mosquitto HA)은 미착수.
