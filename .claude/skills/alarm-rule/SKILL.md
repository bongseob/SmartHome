---
name: alarm-rule
description: Define or review an alarm policy in the SmartHome system across the three SRS tiers (Reactive / Proactive / Optimization) — threshold, severity, routing, notification channel, escalation, correct QoS, and Alarm_Log persistence. Use when adding or changing any alarm/threshold rule.
---

# 알람 정책 정의

SRS 3.3 / 4.3의 알람 규칙을 빠짐없이 구현하기 위한 절차.
근거: [CLAUDE.md](../../../CLAUDE.md) §6·§8.

## 이 스킬을 쓰는 때
- 새 임계치/알람 규칙을 추가할 때
- 알람 라우팅·에스컬레이션·채널을 바꿀 때

## 1. 계층 결정 (SRS 3.3)
| 계층 | 예 | QoS | 처리 |
|---|---|---|---|
| Reactive | 화재·침입·누수·고장 | **2** | 즉시 라우팅 + 에스컬레이션 |
| Proactive | 배터리·필터·펌웨어 | 1 | 배치/예방 알림 |
| Optimization | 불필요 조명·에너지·온도 | 0~1 | 대시보드 안내(저심각도) |

## 2. 정책 구성요소 (모두 필수)
- [ ] **임계치** (조건식/비교연산/지속시간)
- [ ] **Severity**
- [ ] **Routing Rule** (누구/어느 채널로)
- [ ] **Notification Channel** (push/email/SMS 등)
- [ ] **Escalation Rule** (미대응 시 승급 경로/시간)

## 3. 저장·전파
- [ ] 알람 발생/상태변경은 **`Alarm_Log`** 에 저장 (Audit_Log와 분리)
- [ ] 크리티컬 알람 토픽은 `.../{device}/alarm` **QoS 2**
- [ ] **알람 전파 ≤ 3초** (SRS 6) 유지 — 동기 블로킹 라우팅 금지

## 4. 사용자 조치
- [ ] Ack / Snooze 지원 (USER), 조치 이력 등록 (MONITOR)
- [ ] 조치·승인 행위는 감사 대상 → Audit_Log

## 5. LWT/Offline 연동
- [ ] LWT로 감지된 OFFLINE, Threshold 초과, Battery 등은 Alarm_Log 이벤트로 기록

## 안티패턴
- Reactive 알람을 QoS 0/1로 발행
- Alarm_Log 대신 Audit_Log에 기록
- 에스컬레이션 없는 긴급 알람
