# SRS 부속 요구사항 — 조명/부하 제어 도메인 (Lighting & Load Control Addendum)

**Document Version : 0.1 (2026-07-11 신규)**
**상위 문서 :** [iot_smarthome_srs.md](../iot_smarthome_srs.md) · **구현 규칙 :** [PROJECT_RULES.md](../PROJECT_RULES.md)

---

## 0. 개요

이 문서는 실제 운영 중인 **차단기 기반 조명/부하 제어 시스템**의 요구기능(요구기능.md)을
기존 MQTT/UNS 스마트홈 SRS에 **범용화하여 통합**한 부속 요구사항이다.
SRS 원본은 "무엇을"의 기준 문서로 유지하고, 이 문서는 그 위에 **조명/부하 제어 도메인의
구체 요구사항**을 얹는다. 충돌 시 SRS의 상위 정의가 우선한다.

### 0.1 도메인 용어 범용화 (필수 해석 규칙)

레거시 용어는 아래와 같이 기존 SRS 개념으로 **범용화하여 해석**한다. 신규 코드/문서에서는
**오른쪽(범용) 용어**를 정본으로 쓰고, 왼쪽은 UI 라벨/설명에서만 병기한다.

| 레거시 용어 | 의미 | 범용(정본) 매핑 |
|---|---|---|
| 차단기 | 단말에 설치되는 스위치/센서 | **Device** (액추에이터, `device_category = DEVICE`) |
| 감시장비 | 단말을 제어하는 보드(RMU) | **Gateway** (`device_category = GATEWAY`) |
| 분전반 | 보드가 위치하는 장소 | **Area** 의 한 종류(Panel형 Area) — §2 |
| 지역 | 건물의 층 | **floor** (기존 UNS 계층) |
| RMU | 차단기를 포함하는 감시장비 | 해당 Device의 소속 **Gateway** |
| 조명구분(일반/비상/예비) | 부하 종류 구분 | **Load Class**(부하 구분) 신규 enum — §3.2 |
| 그룹 | 제어·모니터링 단위 | 기존 **Device_Group** (SRS 3.1.2) |

### 0.2 확정된 통합 결정 (2026-07-11 합의)

이 문서를 쓰기 전 사용자와 합의한 세 가지 핵심 결정. 근거는 PROJECT_RULES 부록 A와 일관된다.

1. **작성 위치 = docs/ 부속 문서**. SRS 원본을 크게 고치지 않고 확장 문서로 관리한다
   (PROJECT_RULES §11 — 산출물은 `docs/`). SRS·[docs/README.md](README.md)에서 상호참조한다.
2. **분전반 = Area의 한 종류(Panel형)**. 기존 UNS 6계층
   (`enterprise/site/building/floor/area/device`)을 **그대로 유지**하고, 분전반은 배경이미지·
   좌표를 가진 Area 하위 유형으로 모델링한다. **UNS 토픽 규칙(PROJECT_RULES §2)은 불변**이다.
3. **감시장비 = Gateway (MQTT 정규화)**. 레거시의 서버↔보드 직접 TCP 통신은 **엣지 프로토콜
   브리지**로 흡수하고, Gateway↔플랫폼 구간은 고정 결정대로 **MQTT 전용**을 유지한다(§4).
   고정 IP/포트(서버 192.168.10.5:12005, 보드 :20000)는 하드코딩이 아니라 **설정값**으로 둔다.

---

## 1. 시스템 기본정보 확장 (SRS 2.1.1 보강)

관리자는 SRS 2.1.1(공간 관리)에 더해 다음 **시스템 기본정보**를 관리한다.

- **서버 통신 엔드포인트** — 플랫폼이 레거시 감시장비(보드)와 통신하기 위한 서버측 리슨
  주소/포트. 레거시 기본값 `192.168.10.5:12005`. **고정값을 코드에 박지 않고** 시스템 설정으로
  관리한다(환경/DB 설정). 이 값은 §4의 엣지 브리지에만 의미가 있으며, MQTT 브로커 주소와는 별개다.
- **Site/Building 이름** — 기존 SRS 2.1.1(2026-07-10) 범위 유지. 조직 계층 생성/삭제는 범위 밖.

> 결정: 서버↔보드 통신은 §4에서 MQTT로 정규화되므로, 위 엔드포인트는 **레거시 보드를
> 브리징하는 경우에만** 사용하는 마이그레이션/호환 설정이다. 신규 Gateway는 MQTT로 직접 붙는다.

---

## 2. 이미지 라이브러리 & 공간 배치 (SRS 2.1.1 / 3.2 보강)

### 2.1 이미지 라이브러리 (신규)

지역(floor)·분전반(Area) 등의 **배경이미지를 재사용 가능한 라이브러리**로 관리한다.

- 관리항목: `Image ID`(유일값), `이미지 이름`, 이미지 파일.
- 저장 방식은 기존 결정(PROJECT_RULES 부록 A.1, 2026-07-10)을 따른다 — **로컬 파일시스템**에
  저장하고 `/uploads/...`로 정적 서빙, 오브젝트 스토리지·DB bytea 아님.
- floor/Area는 이미지를 **ID로 참조**한다(파일 경로 중복 방지). 기존 `floor_map.image_url`
  유일 제약(마이그레이션 0012)과 정합하도록, 라이브러리 도입 시 참조 무결성을 마이그레이션으로 잡는다.

### 2.2 지역(floor) 배경 배치

- 각 층은 배경이미지와 **표시 좌표(POS-X, POS-Y)**를 가진다(레거시 지역관리와 동일).
- 기존 Floor Map 관제(SRS 3.2: Zoom/Pan/Layer/Grid/Marker/Polygon)를 그대로 사용한다.

### 2.3 분전반(Panel형 Area) — 신규

분전반은 **배경이미지·좌표를 가진 Area의 한 종류**로 모델링한다.

- 관리항목: 소속 `지역(floor)`, `분전반명`(유일 식별), `배경이미지`(ID 참조), `좌표`.
- UNS 토픽에서 분전반은 **area 세그먼트**에 해당한다:
  `enterprise/{site}/{building}/{floor}/{panel-area}/{device}`. 토픽 문자열은 반드시
  `buildTopic()`으로 생성(PROJECT_RULES §2), 세그먼트는 소문자 kebab-case.
- Area 유형을 구분하기 위한 속성(예: `area_kind = ROOM | PANEL`)을 도입할 수 있다. enum이 필요하면
  `packages/contracts`에서만 정의한다(단일 소스 원칙).

---

## 3. 감시장비(Gateway) & 차단기(Device) 관리 (SRS 2.1.2 / 3.1.1 보강)

### 3.1 감시장비 = Gateway 관리항목

레거시 감시장비관리를 Gateway 등록(SRS 2.1.2)으로 흡수한다.

- `Gateway ID`(=감시장비 유일값), `Gateway 이름`(그룹관리에서 참조), 소속 `지역(floor)`,
  소속 `분전반(Panel형 Area)`, `IP`, `PORT`(레거시 기본 `20000`).
- IP/PORT는 **Gateway의 레거시 TCP 엔드포인트**로, §4 엣지 브리지가 MQTT로 변환할 때 쓰는
  연결 파라미터다. Gateway↔플랫폼 정본 전송은 MQTT(PROJECT_RULES §2·§3).

### 3.2 차단기 = Device 관리항목

레거시 차단기관리를 Device 등록(SRS 3.1.1)으로 흡수한다. Device 기본 필드에 더해:

- **RMU** → 해당 Device의 소속 **Gateway**(감시장비).
- **Address** — Gateway 버스 상의 장비 주소(레거시는 `06`부터 시작). Device↔Gateway 연결
  파라미터로 취급하여 `Connection Config`(SRS 3.1.1의 jsonb) 또는 전용 컬럼에 기록한다.
- **분전반명** → 소속 **Panel형 Area**(§2.3).
- **Load Class(부하 구분)** — 신규 enum `NORMAL`(일반) / `EMERGENCY`(비상) / `RESERVE`(예비).
  - `RESERVE`(예비)는 **관제 화면에 표시하지 않는다**(레거시 "예비는 화면에서 보이지 않음").
  - enum은 `packages/contracts`에서만 정의(단일 소스 원칙).
- **설명(Description)** — 자유 텍스트.

### 3.3 그룹 관리 (기존 재사용)

- 그룹(제어·모니터링 단위)은 기존 **Device_Group**(SRS 3.1.2, N:M 매핑)을 사용한다.
- 관리항목: `그룹 ID`, `그룹명`. 신규 개념 없음 — 레거시 그룹관리 = 기존 Device_Group_Mapping.

---

## 4. 서버↔감시장비 통신의 MQTT 정규화 (SRS 4.1 정합)

레거시의 서버↔보드 직접 TCP 통신(서버 12005 / 보드 20000)은 다음과 같이 흡수한다.

- **정본 전송 = MQTT**. 신규 감시장비(Gateway)는 Mosquitto에 직접 연결하고, PROJECT_RULES
  §2·§3의 토픽/QoS/LWT/Retained 규칙을 그대로 따른다(제어 `.../cmd` QoS 1, 상태 `.../state`
  Retained, 크리티컬 알람 `.../alarm` QoS 2, LWT 필수).
- **레거시 보드는 엣지 프로토콜 브리지**로 수용한다. 브리지가 TCP(12005 리슨 / 보드 20000)를
  플랫폼 표준 MQTT 메시지로 양방향 변환한다. 이는 기존 "Connection Protocol"(TCP_IP 등,
  PROJECT_RULES 부록 A.1) 개념의 서버측 확장이며, **Gateway↔플랫폼 = MQTT 전용** 고정 결정을
  대체하지 않는다.
- 고정 IP/포트 값은 §1·§3.1의 **설정값**으로만 존재하고, 토픽/명령 코드에 하드코딩하지 않는다.

---

## 5. 제어 관리 (SRS 3.1.3 / 4.3 정합)

관리자·사용자는 차단기(Device)를 **그룹별 또는 개별**로 ON/OFF 제어한다(레거시 제어관리).

- **일괄제어(Batch)** — 그룹에 포함된 모든 Device를 한 번에 ON/OFF. SRS 2.1.4 Batch Control과 동일.
- **개별제어(Individual)** — 그룹 내 Device를 선택적으로 ON/OFF(팝업 UI).
- **순차 제어 간격(신규 NFR)** — 그룹 일괄 제어 시 돌입전류(inrush) 완화를 위해 Device 명령을
  **약 1.5초 간격으로 순차 발행**한다. 간격은 설정값(기본 1500ms)으로 두고 하드코딩하지 않는다.
  - 각 개별 명령은 표준 명령 수명주기(CREATED→PENDING→IN_PROGRESS→SUCCEEDED/FAILED/TIMED_OUT)를
    그대로 따르고, **모든 상태 전이를 Audit_Log에 기록**한다(PROJECT_RULES §4 — 위반 금지).
  - 일괄 제어의 각 명령은 표준 JSON payload + MQTT5 User Properties(Actor/Session/Command/Role)를
    사용한다. 절차는 `.claude/skills/mqtt-command` 체크리스트를 따른다.

> 성능 목표(SRS 6)의 "명령 처리 지연 ≤ 300ms"는 **개별 명령 단위** 기준이다. 1.5초 간격은
> 그룹 내 명령 간 의도적 지연이며 개별 명령 지연과 구분한다.

---

## 6. 예약·스케줄 관리 (SRS 3.4 보강)

레거시 예약관리/타임프로그램/스케줄등록을 기존 Scheduler(SRS 3.4) 위에 구체화한다.

### 6.1 예약관리 (One-Time 예약 + 취소)

- 그룹으로 지정된 Device를 대상으로 **날짜·시간을 지정하여 ON/OFF를 1회 예약**한다
  (Scheduler `One Time`).
- 예약 목록을 제공하고, **아직 실행되지 않은(pending) 예약은 "예약취소" 가능**하다.
  이미 실행된 예약은 취소 불가. 예약 생성/취소는 감사 로그 대상(SRS 4.2.4).

### 6.2 타임프로그램 (Time Program) — 신규

- **정기 운영 스케줄 템플릿**. 시스템 전체에서 **최대 300개**의 프로그램을 정의할 수 있다.
- 각 프로그램은 **요일별(일·월·화·수·목·금·토) 및 공휴일별로 별도의 ON/OFF 운영 스케줄**을 가진다.
- 공휴일 판정은 §7 휴일관리를 따른다(음력 공휴일 포함).

### 6.3 스케줄 등록 관리 (프로그램↔그룹 매핑) — 신규

- 작성된 **타임프로그램(번호)에 Device_Group을 매핑**하여 정기 스케줄을 활성화한다.
- 하나의 프로그램을 여러 그룹에 매핑할 수 있다(매핑은 별도 화면에서 수행).

---

## 7. 휴일 관리 (신규 — SRS 3.4 지원 데이터)

타임프로그램의 공휴일 스케줄 판정을 위한 **휴일 달력**을 관리한다.

- 관리항목: `날짜`(월·일), **`음양구분`**(신규 enum `SOLAR`(양력) / `LUNAR`(음력)), `휴일명`.
- **음력 공휴일 지원** — 설날·추석 등은 `LUNAR`로 등록하고, 스케줄 판정 시 해당 연도의 양력
  날짜로 변환(음→양 변환 로직 필요)한다.
- **연휴는 해당되는 모든 날짜를 각각 등록**한다(레거시 주의사항 — 범위 자동확장 없음).
- enum은 `packages/contracts`에서만 정의. 휴일 데이터는 마이그레이션이 아닌 운영 데이터로 CRUD.

---

## 8. 장애이력 조회 (SRS 4.3 로그 위 조회 뷰)

레거시 장애이력을 **기존 3계층 로그(PROJECT_RULES §7) 위의 통합 조회 뷰**로 제공한다.
**새 로그 저장소를 만들지 않는다** — Audit_Log/Alarm_Log를 기간·등급으로 질의한다.

- **등급별 조회**
  - **알림(INFO)** — *제어에 의한* ON/OFF 상태. 출처 = `Audit_Log`(제어 이력).
  - **경고(WARNING)** — *알람에 의한* ON/OFF 상태. 출처 = `Alarm_Log`(예외 이벤트).
  - **전체(ALL)** — 위 둘의 합집합.
- **기간별 조회** — 시작~종료 구간 필터.
- 등급 라벨은 기존 `severity`(INFO/WARNING/CRITICAL) 및 로그 출처로 도출하며, 별도 신규 enum이
  필요하면 `packages/contracts`에서만 정의한다.

---

## 9. 사용자 권한 매핑 (SRS 2 / PROJECT_RULES §6 정합)

레거시 2단계 권한을 기존 RBAC로 매핑한다.

| 레거시 권한 | 범위 | 기존 Role 매핑 |
|---|---|---|
| 관리자 | 모든 권한(구성·제어·예약·이력) | **ADMIN** |
| 일반 | 현황 모니터링 + 개별 제어 | **USER** (허가 Area 내 조회·ON/OFF). 감시 특화면 **MONITOR** 병행 |

- 신규 Role 없음. 권한 검사는 Area·Device·Group 단위(PROJECT_RULES §6).

---

## 10. 신규 도메인 요소 요약 (구현 착수용)

이 부속 요구사항이 파생시키는 신규 항목. **DDL은 node-pg-migrate 마이그레이션으로만**,
**enum은 `packages/contracts`에서만** 정의한다(PROJECT_RULES §11).

| 구분 | 신규 요소 | 참조 |
|---|---|---|
| enum | `LoadClass` = NORMAL / EMERGENCY / RESERVE | §3.2 |
| enum | `LunarSolar` = SOLAR / LUNAR | §7 |
| enum(선택) | `AreaKind` = ROOM / PANEL | §2.3 |
| 엔티티 | Image 라이브러리(ID·이름·파일) | §2.1 |
| 엔티티 | Panel형 Area(배경이미지·좌표) | §2.3 |
| 컬럼 | Device: Load Class, Address(Gateway 버스 주소), 설명 | §3.2 |
| 컬럼 | Gateway: 레거시 IP/PORT(TCP 브리지용) | §3.1 |
| 엔티티 | Holiday(날짜·음양구분·휴일명) | §7 |
| 엔티티 | Time Program(≤300, 요일별+공휴일 스케줄) | §6.2 |
| 매핑 | Time Program ↔ Device_Group | §6.3 |
| 매핑 | Reservation(One-Time + 취소) | §6.1 |
| 설정 | 순차 제어 간격(기본 1500ms) | §5 |
| 설정 | 서버↔보드 엔드포인트(192.168.10.5:12005 / 보드 20000) | §1·§4 |
| 컴포넌트 | 엣지 프로토콜 브리지(TCP↔MQTT) | §4 |
| 조회 뷰 | 장애이력(등급·기간, Audit/Alarm 로그 위) | §8 |

### 10.1 후속 산출물 반영 필요

이 요구사항을 확정하면 다음 산출물에 반영한다(각 문서에서 후속 처리):
[docs/erd.md](erd.md)(신규 테이블/컬럼·enum), [docs/mqtt-topic-design.md](mqtt-topic-design.md)
(Panel형 area 세그먼트), [docs/api-spec.md](api-spec.md)·[docs/openapi.yaml](openapi.yaml)
(이미지/분전반/휴일/타임프로그램/예약/장애이력 API), [docs/ui-ux-design.md](ui-ux-design.md)
(개별제어 팝업·예비 숨김·예약목록·이력 등급 필터), [docs/implementation-tracker.md](implementation-tracker.md)(마일스톤).
