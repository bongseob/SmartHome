---
name: hitl-recommendation
description: Add or review an AI recommendation with confidence-gated Human-In-The-Loop approval in the SmartHome system — confidence threshold + high-risk-device gate, Approve/Reject flow, learning-data capture, and AI-actor Audit_Log. Use when adding any AI-driven control suggestion (energy saving, away/sleep detection, risk prediction, anomaly).
---

# AI 추천 + HITL 승인 흐름

AI 제안 제어가 **승인 없이 실행되지 않도록** 안전 규칙을 강제하는 절차.
근거: [CLAUDE.md](../../../CLAUDE.md) §7, SRS 3.5 / 2.4.

## 이 스킬을 쓰는 때
- 새 AI 추천 유형 추가: 이상행동 감지·에너지 절감·외출/취침 판단·위험 예측
- 추천이 유발하는 제어의 승인 게이트를 만들 때

## 핵심 안전 규칙 (위반 금지)
1. AI 추천은 **직접 실행하지 않는다**. 항상 recommendation 레코드를 먼저 만든다.
2. **HITL 승인 필요 조건** (둘 중 하나라도 참이면 승인 필수):
   - `confidenceScore < 임계치`, 또는
   - 대상이 **고위험 장치**: 메인 차단기 · 도어락 · 가스 차단 · 전체 조명 제어
3. 승인자는 **Approve / Reject** 중 하나 선택. Reject면 실행하지 않는다.
4. **Approve/Reject 결과는 모두 학습 데이터로 저장** (누락 금지).
5. Approve 후 실제 제어는 `mqtt-command` 스킬 흐름을 그대로 탄다.
   Audit_Log `Actor Type = AI`, 승인자 정보는 `Reason`/별도 승인 이력에 기록.

## 구현 체크리스트
- [ ] recommendation 엔티티: `type, target, proposedCommand, confidenceScore, status(PENDING_APPROVAL/APPROVED/REJECTED/EXECUTED), createdAt`
- [ ] 게이트: confidence 임계치 + 고위험 장치 목록 검사 → 필요 시 `PENDING_APPROVAL`
- [ ] 승인 프롬프트: 사용자에게 예/아니오 형태로 제시 (예: "외출 감지됨. 모든 조명 소등?")
- [ ] Approve → `mqtt-command` 발행 + 수명주기/Audit_Log
- [ ] Reject → 실행 안 함, 사유 저장
- [ ] **학습 데이터 파이프라인**: 모든 결정(승인/거절 + context)을 학습 저장소에 적재
- [ ] System Timeline에 이벤트 표시 (추천 생성 → 승인 → 실행 → 성공)

## 안티패턴
- 저신뢰/고위험 제어를 승인 없이 자동 실행
- Approve/Reject 이력을 저장하지 않음
- AI 유발 제어의 Actor Type을 USER/SYSTEM으로 기록
