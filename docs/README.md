# docs — 프로젝트 산출물

프로젝트를 진행하며 생성되는 **모든 산출물 문서**는 이 폴더에서 관리한다.
설계·명세·다이어그램 등은 여기에 두고, 규칙은 루트의 [PROJECT_RULES.md](../PROJECT_RULES.md)를 따른다.

## 규칙
- 산출물 문서는 반드시 `docs/` 아래에 생성한다(루트에 흩뿌리지 않는다).
- 파일명은 소문자 kebab-case + 목적이 드러나는 이름 (예: `erd.md`, `mqtt-topic-design.md`).
- 새 산출물을 추가하면 아래 목록에 한 줄로 등록한다.
- 예외: 에이전트 지시/규칙 파일(`AGENTS.md`, `CLAUDE.md`, `PROJECT_RULES.md`)과
  요구사항 원본(`iot_smarthome_srs.md`)은 루트에 유지한다.

## 산출물 목록 (SRS §8 후속 산출물 기준)

| 산출물 | 파일 | 상태 |
|---|---|---|
| ERD (DB 설계) | [docs/erd.md](erd.md) | 초안 v0.1 |
| MQTT Topic 설계서 | [docs/mqtt-topic-design.md](mqtt-topic-design.md) | 초안 v0.1 |
| REST API 명세 (OpenAPI/Swagger) | [docs/api-spec.md](api-spec.md) | 초안 v0.1 |
| REST API OpenAPI skeleton | [docs/openapi.yaml](openapi.yaml) | 작성 중 |
| 화면(UI/UX) 설계서 | [docs/ui-ux-design.md](ui-ux-design.md) | 초안 v0.1 |
| 시퀀스 다이어그램 | [docs/sequence-diagrams.md](sequence-diagrams.md) | 초안 v0.1 |
| 시스템 아키텍처 (HLD/LLD) | [docs/architecture.md](architecture.md) | 초안 v0.1 |
| 기기 수명주기 & 펌웨어 OTA | [docs/device-lifecycle-ota.md](device-lifecycle-ota.md) | 초안 v0.1 |
| SRS 부속 — 조명/부하 제어 도메인 | [docs/srs-lighting-control-addendum.md](srs-lighting-control-addendum.md) | 초안 v0.1 |

## 개발 지원 산출물 (SRS 외)

| 산출물 | 파일 | 상태 |
|---|---|---|
| 가상 기기 시뮬레이터 계획 | [docs/device-simulator.md](device-simulator.md) | 초안 v0.1 |
| 테스트 / QA 전략 | [docs/test-strategy.md](test-strategy.md) | 초안 v0.1 |
| 구현 추적 문서 | [docs/implementation-tracker.md](implementation-tracker.md) | 작성 중 |

> 산출물을 작성하면 상태를 `작성 중` / `완료`로 갱신한다.
