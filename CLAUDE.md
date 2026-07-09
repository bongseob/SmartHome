# Agent Instructions

이 저장소의 에이전트 작업 규칙은 `PROJECT_RULES.md`를 기준으로 한다.

작업 순서:

1. `iot_smarthome_srs.md`를 요구사항(SRS) 원본으로 읽는다.
2. `PROJECT_RULES.md`에서 합의된 기술/운영 규칙을 확인한다.
3. 구현 전 사용자 합의가 필요한 미정 사항(`PROJECT_RULES.md` 부록 A.2 열린 항목)이 있으면 먼저 질문한다.
4. 다음을 임의로 도입/우회하지 않는다.
   - UNS 토픽 문자열 하드코딩 (반드시 `buildTopic()` 사용)
   - Audit_Log 없이 제어 명령 발행, 명령 수명주기 상태 건너뛰기
   - HITL 승인 없이 저신뢰/고위험 AI 제어 자동 실행
   - QoS/LWT/Retained/로깅 3계층 규칙 위반
   - 마이그레이션 없는 수동 DDL, `packages/contracts` 밖의 도메인 enum 정의

주요 고정 결정:

- Backend: NestJS (Node.js + TypeScript)
- Frontend: React + TypeScript (Floor Map: Konva)
- 관계형 DB: PostgreSQL
- DB 접근: `pg` + repository 패턴 (**ORM 미사용**), 마이그레이션 = node-pg-migrate
- 시계열 DB: TimescaleDB
- 상태/캐시/큐: Redis
- MQTT Broker: **Mosquitto** (전용, 앱 내장 금지) + `mqtt.js`, MQTT 5 (User Properties · QoS · LWT 규칙 준수)
- 인증: **JWT 자체 발급 우선** (기기: MQTT ID/PW, 서비스간: mTLS/API Key, OAuth2는 추후)
- 통신 보안: 전 구간 TLS(wss/mqtts)
- 모노레포: **pnpm workspaces + Turborepo**
- 공유 계약: `packages/contracts` 단일 소스 (payload·enum·토픽)
- 작업 절차: `.claude/skills/`의 mqtt-command · device-onboarding · alarm-rule · hitl-recommendation 체크리스트
