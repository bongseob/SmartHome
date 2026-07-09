# 테스트 / QA 전략 — SmartHome IoT 관제 시스템

- 근거: [PROJECT_RULES.md](../PROJECT_RULES.md), [architecture.md](architecture.md), [device-simulator.md](device-simulator.md), SRS 6(성능)
- 상태: 초안 v0.1 (2026-07-09)  ·  분류: 개발 지원 산출물

---

## 1. 목표 & 원칙

- **규칙 준수를 테스트로 강제**한다: 감사 누락·수명주기 위반·QoS 오류·권한 우회는 자동 테스트로 잡는다.
- **가상 기기(시뮬레이터)를 1급 테스트 도구**로 사용(실기기 불가). E2E/부하/결함 재현에 활용.
- **계약 우선**: `packages/contracts`(payload·enum·토픽)를 계약 테스트로 고정 → api/gateway/simulator 드리프트 차단.
- 모든 성능 목표(SRS 6)는 **측정 가능한 테스트**로 매핑한다.

## 2. 테스트 피라미드

| 층 | 대상 | 도구(후보) | 실행 |
|---|---|---|---|
| Unit | repository·상태머신·프로파일·가드 로직 | Vitest/Jest | 매 커밋(빠름) |
| Contract | contracts payload/topic 스키마 | Zod/JSON-Schema 검증 | 매 커밋 |
| Integration | api↔DB, gateway↔broker↔DB | **Testcontainers**(Postgres+Timescale, Mosquitto) | PR |
| E2E | 시뮬레이터→gateway→api→WS/대시보드 | 시뮬레이터 + Playwright(web) | PR/야간 |
| Performance | SRS 6 목표 | k6/artillery + 시뮬레이터 부하모드 | 야간/릴리스 |
| Chaos/Fault | 장애·결함 경로 | 시뮬레이터 fault 주입 | 야간 |
| Security | authz/ACL/injection | 커스텀 + zap/lint | 릴리스 |

## 3. 반드시 커버할 불변식 (규칙 기반)

> PROJECT_RULES 위반을 잡는 **핵심 테스트**. 이들은 "있으면 좋은" 게 아니라 **필수 게이트**.

| 불변식 | 검증 방법 |
|---|---|
| 명령 **모든 상태 전이 → audit_log 1행** (§4.3) | 정상/실패/타임아웃/중복 4경로별 audit 행 수·값 assert |
| **기록 없는 제어 불가** — 상태전이+audit 동일 트랜잭션 | DB 장애 주입 시 명령·audit 원자적 롤백 확인 |
| **멱등성** — 동일 commandId 재실행 금지 | 중복 발행 시 device 1회만 실행, 2번째는 최초 결과 |
| **QoS 매핑** (telemetry0/control1/alarm2) | 브로커 캡처로 QoS 검증 |
| **LWT/Offline** | 시뮬레이터 강제 종료 → OFFLINE 상태·alarm_log 생성 |
| **retained는 state만** | telemetry/cmd/alarm retained=false 확인 |
| **RBAC/ACL** | 권한 밖 Area 제어/구독 시 403·ACL 거부 |
| **HITL 게이트** — 고위험 장치·저신뢰는 **승인 없이는 실행 불가** | 승인 없이 실행 시도 → 차단, 승인 후에만 명령 발행 |
| **User Properties**에 감사 메타(payload 중복 금지) | 발행 메시지의 User Properties 존재·payload 미중복 |

## 4. 성능 테스트 — SRS 6 매핑

| SRS 목표 | 테스트 | 판정 |
|---|---|---|
| 명령 처리 ≤ 300ms(평균) | 명령 발행→ack 왕복 지연 분포 | avg ≤ 300ms, p95 리포트 |
| 센서 반영 ≤ 1s | telemetry 발행→DB/WS 반영 지연 | ≤ 1s |
| 알람 전파 ≤ 3s | alarm 발행→대시보드/알림 | ≤ 3s |
| 동시 사용자 ≥ 500 | WS/REST 부하(가상 사용자) | 오류율·지연 SLA 유지 |
| 동시 기기 ≥ 100,000 | 시뮬레이터 부하모드(`sim load`) | 수집 손실·지연 임계 내 |
| 가용성 ≥ 99.9% | 장애 주입 + 복구시간 측정 | 목표 예산 내 |

- 부하 데이터는 시뮬레이터 fleet(§device-simulator 4·12)로 생성. 관측 메트릭과 연계(§architecture 12).

## 5. E2E 시나리오 (골든 패스)

시뮬레이터 시나리오(§device-simulator 11)와 1:1로 매핑:
1. **제어 왕복**: 사용자 turn_on → ack → state ON → 대시보드 반영 + audit 체인.
2. **타임아웃**: device ack 미발행 → TIMED_OUT 전이 + audit.
3. **알람+에스컬레이션**: 가스누출 → alarm_log → 라우팅 → 미대응 승급 → Ack.
4. **알람+카메라 현장확인**: linked_camera 자동 프리셋 → 라이브 뷰 → PTZ 제어 audit.
5. **AI/HITL**: 외출 감지 추천 → 고위험 승인 → 실행(actorType=AI) → 학습데이터 저장.
6. **스케줄러**: cron 도래 → 명령 발행 → schedule_run 기록.
7. **도면 편집**: 편집 모드 드래그 배치 → `/floors/{id}/layout` 저장 → audit(DEVICE_RELOCATE).

## 6. 결함/카오스 테스트

시뮬레이터 fault 주입(§device-simulator 7)으로:
- device FAILED(reasonCode), TIMED_OUT, 강제 Offline
- 브로커 재시작(재연결·세션 복원), DB 일시 장애(트랜잭션 원자성), 네트워크 지연
- 백프레셔: telemetry 폭주 시 배치 insert/드롭 정책 확인

## 7. 보안 테스트

- 인증: 만료/위조 JWT 거부, refresh 재사용 차단.
- 인가: Area/Device/Group 권한 경계(수평 권한 상승 시도).
- MQTT ACL: 기기가 타 device 서브트리 발행/구독 시 거부.
- 입력 검증: payload 스키마 위반·SQL 인젝션(파라미터라이즈드 확인).
- **카메라 접근**: 스트림 URL 서명 만료·권한 없는 조회 차단, 조회 감사 기록(§camera governance 후속).

## 8. 테스트 데이터 & 환경

- **단일 소스 시드**: fleet 정의 → DB seed + 시뮬레이터(§device-simulator 13)로 일관.
- 환경: `test`(Testcontainers, 격리) / `dev`(공유 시뮬레이터) / `staging`(성능·E2E).
- 프로덕션 자격증명·토픽으로 테스트 실행 금지(§device-simulator 14).

## 9. CI 게이트 & 커버리지

- PR 게이트: lint + typecheck + unit + contract + integration 통과 필수.
- 커버리지 목표: 도메인 로직(상태머신·가드·repository) **높은 커버리지**, §3 불변식은 100% 케이스.
- 야간: E2E + 성능 + 카오스 리포트.

## 10. 추적성 (요구사항 ↔ 테스트)

- 각 테스트에 SRS 조항/규칙 태그(예 `@srs-4.3.4`, `@rule-lifecycle`)를 부여해
  요구사항 커버리지 매트릭스를 자동 생성.

## 11. 미해결/후속

- 도구 확정(Vitest vs Jest, k6 vs artillery, testcontainers 구성)
- 성능 목표 재현 인프라(10만 기기 부하의 실행 환경)
- 계약 스키마 언어(Zod ↔ OpenAPI ↔ JSON-Schema) 단일화
- 시각 회귀(도면/대시보드) 테스트 도입 여부
