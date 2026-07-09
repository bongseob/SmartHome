# 지능형 IoT 및 스마트홈 관제 시스템 요구사항 정의서(SRS)

**Document Version : 1.0**

---

## 1. 시스템 개요

### 1.1 목적

본 시스템은 MQTT(Message Queuing Telemetry Transport)와 UNS(Unified Namespace) 기반의 지능형 IoT 및 스마트홈 통합 관제 플랫폼을 구축하는 것을 목적으로 한다.

시스템은 다양한 IoT 장치와 센서를 중앙에서 통합 관리하며, 공간 인지형(Spatial-aware) 도면 기반 UI를 제공하여 사용자가 직관적으로 장치를 제어할 수 있도록 한다.

또한 AI 기반의 상황 인지(Context Awareness)와 HITL(Human-In-The-Loop) 승인 체계를 결합하여 자동화와 안전성을 동시에 확보한다.

---

### 1.2 시스템 구성

본 시스템은 다음과 같은 구성요소로 이루어진다.

- MQTT Broker
- IoT Device Gateway
- UNS Topic Manager
- Device Management Service
- Floor Map Management Service
- Scheduler Service
- Alarm Service
- AI Recommendation Engine
- Audit & Logging Service
- Web Dashboard
- Mobile Dashboard

---

## 2. 사용자 및 권한 관리

시스템은 RBAC(Role Based Access Control)를 적용하여 사용자 권한을 관리한다.

---

### 2.1 관리자(Admin)

관리자는 시스템 전체를 구성하고 운영 정책을 관리하는 최고 권한을 가진다.

#### 2.1.1 공간 관리

- 평면도 업로드
- 평면도 스케일 지정
- Polygon 기반 공간(Area) 생성
- 공간 수정/삭제

#### 2.1.2 기기 관리

- Device 등록
- Sensor 등록
- Gateway 등록
- Device 위치 지정(x,y)
- Area 매핑
- Device 상태 확인

#### 2.1.3 그룹 관리

- Device Group 생성
- Dynamic Group 생성
- Device 다중 그룹 매핑(N:M)
- UNS Topic 생성

예시:

```text
enterprise/site/building/floor/area/device
```

#### 2.1.4 자동화 관리

관리자는 다음 기능을 설정할 수 있어야 한다.

- Scheduler 생성
- 반복 일정
- Cron 일정
- 이벤트 기반 일정
- JSON Payload 작성
- Batch Control

#### 2.1.5 알람 정책 관리

관리자는 다음 항목을 설정할 수 있다.

- 임계치
- Severity
- Routing Rule
- Notification Channel
- Escalation Rule

#### 2.1.6 사용자 관리

관리자는 다음 기능을 수행할 수 있다.

- 사용자 생성
- 권한 관리
- Area 권한 지정
- Device 권한 지정
- Group 권한 지정

---

### 2.2 일반 사용자(User)

일반 사용자는 자신에게 허가된 공간만 접근할 수 있다.

주요 기능은 다음과 같다.

- 장치 조회
- 장치 ON/OFF
- 센서값 조회
- Device History 조회
- 알람 확인(Acknowledge)
- Snooze 처리

---

### 2.3 모니터링 담당자(Monitor)

모니터링 담당자는 다음 기능을 수행할 수 있다.

- 실시간 상태 감시
- 긴급 알람 대응
- 이벤트 확인
- 장애 확인
- 조치 이력 등록

---

### 2.4 HITL 승인 사용자

AI가 제안한 자동 제어는 승인 권한을 가진 사용자만 최종 실행할 수 있다.

예시:

> "현재 외출 상태가 감지되었습니다. 모든 조명을 소등하시겠습니까?"

사용자는 다음 중 하나를 선택할 수 있어야 한다.

- Approve
- Reject

---

## 3. 기능 요구사항

---

### 3.1 Device 및 UNS 관리

#### 3.1.1 Device 관리

Device는 다음 정보를 가진다.

- Device ID
- Device Name
- Device Type
- Manufacturer
- Model
- Firmware Version
- MQTT Topic
- Current Status

#### 3.1.2 Device Group

Device는 여러 Group에 속할 수 있어야 한다.

```text
Device
Device_Group
Device_Group_Mapping
```

N:M 관계를 지원한다.

#### 3.1.3 표준 MQTT Payload

모든 제어 명령은 JSON을 사용한다.

예시:

```json
{
  "sessionId": "A1001",
  "commandId": "CMD-20260709001",
  "command": "turn_on",
  "target": "device01"
}
```

필수 항목은 다음과 같다.

- Session ID
- Command ID
- Timestamp
- Source
- Target

---

### 3.2 공간 인지형 관제

시스템은 Floor Map 기반의 공간 관제를 지원한다.

지원 기능은 다음과 같다.

- Zoom
- Pan
- Layer
- Grid
- Marker
- Polygon

기기 상태는 다음과 같이 표시한다.

| 상태 | 표시 |
|---|---|
| ON | 녹색 |
| OFF | 회색 |
| Warning | 노란색 |
| Alarm | 빨간색 |
| Offline | 검정 |

Marker 선택 시 다음 정보를 확인할 수 있어야 한다.

- 현재 상태
- 최근 이벤트
- 최근 알람
- 최근 제어 이력
- 센서 데이터
- Device 설정

---

### 3.3 알람 관리

알람은 다음 세 단계로 구분한다.

#### 3.3.1 Reactive Alarm

즉시 대응이 필요한 이벤트이다.

예시:

- 화재
- 침입
- 누수
- 장치 고장

#### 3.3.2 Proactive Alarm

예방 목적의 알람이다.

예시:

- Battery 30%
- Filter 교체
- Firmware Update

#### 3.3.3 Optimization Alarm

효율 개선 목적의 안내성 알람이다.

예시:

- 불필요한 조명 사용
- 에너지 절감
- 온도 최적화

---

### 3.4 Scheduler

지원 대상은 다음과 같다.

- Device
- Device Group

지원 방식은 다음과 같다.

- One Time
- Daily
- Weekly
- Monthly
- Cron
- Event Trigger

---

### 3.5 AI 추천 및 HITL

AI는 다음 기능을 수행한다.

- 이상행동 감지
- 에너지 절감 추천
- 외출 판단
- 취침 판단
- 위험 예측

AI의 신뢰도(Confidence Score)가 기준 이하일 경우 반드시 승인 절차를 거쳐야 한다.

승인 대상 예시는 다음과 같다.

- 메인 차단기
- 도어락
- 가스 차단
- 전체 조명 제어

사용자의 승인/거절은 모두 학습 데이터로 저장된다.

---

## 4. 비기능 요구사항

---

### 4.1 MQTT 통신

#### 4.1.1 QoS

| 데이터 | QoS |
|---|---|
| Telemetry | 0 |
| Control | 1 |
| Critical Alarm | 2 |

#### 4.1.2 LWT

모든 Device는 Last Will and Testament를 설정하여 비정상 종료를 감지해야 한다.

#### 4.1.3 Retained Message

현재 상태 Topic은 Retained Message를 사용한다.

---

### 4.2 보안

#### 4.2.1 TLS

모든 MQTT 통신은 TLS를 적용한다.

#### 4.2.2 MQTT ACL

사용자는 허가된 Topic만 접근 가능해야 한다.

예시:

```text
enterprise/site1/areaA/#
```

관리자는 다음 범위에 접근 가능하다.

```text
enterprise/#
```

#### 4.2.3 인증

다음 인증 방식을 지원한다.

- OAuth2
- JWT
- API Key
- MQTT Username/Password

#### 4.2.4 감사 로그

모든 중요 행위는 감사 로그에 저장한다.

예시:

- 로그인
- 권한 변경
- Device 제어
- Scheduler 변경
- Alarm 승인

---

### 4.3 중앙 로깅 및 감사 추적(Audit Trail)

#### 4.3.1 로그 계층

##### ① Telemetry Log

센서 데이터 로그이다.

저장소 예시는 다음과 같다.

- InfluxDB
- CrateDB
- TimescaleDB

##### ② Alarm Log

예외 이벤트 로그이다.

예시:

- Threshold 초과
- LWT
- Offline
- Battery

저장 테이블:

```text
Alarm_Log
```

##### ③ Audit Log

모든 제어 이력을 저장하는 감사 로그이다.

저장 테이블:

```text
Audit_Log
```

---

#### 4.3.2 Audit_Log 구조

| 컬럼 | 설명 |
|---|---|
| Log ID | PK |
| Timestamp | 발생시간 |
| Actor Type | ADMIN / USER / AI / SYSTEM |
| Actor ID | 행위자 |
| Target Type | Device / Group |
| Target ID | 대상 |
| Command | 실행 명령 |
| Reason | 발생 사유 |
| Execution Status | CREATED / PENDING / IN_PROGRESS / SUCCEEDED / FAILED / TIMED_OUT |
| MQTT Reason Code | 실패 원인 |
| Session ID | 세션 |
| Command ID | 명령 ID |

---

#### 4.3.3 MQTT5 User Properties

명령 메타데이터는 Payload가 아닌 MQTT5 User Properties를 사용한다.

예시:

```text
Actor_ID
Session_ID
Command_ID
Role
Request_Time
```

---

#### 4.3.4 명령 수명주기

```text
CREATED
  ↓
PENDING
  ↓
IN_PROGRESS
  ↓
SUCCEEDED
  ↓
FAILED
  ↓
TIMED_OUT
```

모든 상태 전이는 Audit_Log에 저장되어야 한다.

---

## 5. 대시보드 요구사항

### 5.1 실시간 관제

다음 정보를 실시간으로 표시한다.

- 공간 기반 지도
- Device 상태
- Alarm 상태
- Offline Device
- Network 상태

---

### 5.2 System Timeline

실시간 이벤트를 시간순으로 표시한다.

예시:

```text
10:21 AI 추천 생성
10:22 관리자 승인
10:22 거실 조명 OFF
10:23 성공
```

---

### 5.3 데이터 컨텍스트 차트

센서 그래프 위에 다음 정보를 Marker로 함께 표시한다.

- Alarm
- Human Intervention
- AI Recommendation

---

### 5.4 Device History

Device 선택 시 다음 정보를 Drawer 형태로 제공한다.

- 최근 24시간 이벤트
- 최근 제어
- 최근 알람
- 센서 데이터
- 사용자 조치

---

## 6. 성능 요구사항

- MQTT 명령 처리 지연시간: **평균 300ms 이하**
- 실시간 센서 데이터 반영 지연: **1초 이하**
- 알람 전파 시간: **3초 이하**
- 동시 접속 사용자: **최소 500명**
- 동시 등록 기기: **최소 100,000대**
- 시스템 가용성: **99.9% 이상**
- Audit Log 보존 기간: **최소 5년**
- Telemetry 데이터 보존 정책: **원본 1년, 집계 데이터 5년 이상**

---

## 7. 향후 확장 요구사항

시스템은 다음 기능을 추가할 수 있도록 확장 가능한 구조로 설계되어야 한다.

- 디지털 트윈(Digital Twin) 연계
- BIM(Building Information Modeling) 기반 3D 공간 관리
- AI Vision(CCTV 객체 인식) 연계
- 음성 비서(Voice Assistant) 연계
- 모바일 앱(Android/iOS) 지원
- Open API 및 REST/gRPC 인터페이스 제공
- 외부 BMS(Building Management System) 및 EMS(Energy Management System) 연동
- 다중 건물(Multi-Tenant) 및 클라우드 환경 지원
- AI 모델의 지속적 학습(MLOps) 및 배포 체계 지원

---

## 8. 후속 산출물

본 문서는 요구사항 정의(SRS) 단계에 적합한 기준 문서로 사용한다.

이후 다음 산출물 작성의 기준으로 활용할 수 있다.

- ERD(Database 설계)
- MQTT Topic 설계서
- REST API 명세서(OpenAPI/Swagger)
- 화면(UI/UX) 설계서
- 시퀀스 다이어그램
- 시스템 아키텍처 설계서(HLD/LLD)
