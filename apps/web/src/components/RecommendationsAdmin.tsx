import { useEffect, useRef, useState, type FormEvent } from "react";
import type { RecommendationStatus, RecommendationType } from "@smarthome/contracts";
import {
  ApiError,
  createRecommendation,
  decideRecommendation,
  listDevices,
  listRecommendations,
  retryRecommendationDispatch,
} from "../lib/api";
import type { DeviceListItem, RecommendationRecord } from "../lib/types";

const RECOMMENDATION_TYPES: Array<{ value: RecommendationType; label: string }> = [
  { value: "ANOMALY", label: "이상행동 감지" },
  { value: "ENERGY", label: "에너지 절감" },
  { value: "AWAY", label: "외출 판단" },
  { value: "SLEEP", label: "취침 판단" },
  { value: "RISK", label: "위험 예측" },
];

/** 현재 기기 제어에서 실제로 지원하는 명령만 노출한다(SchedulerAdmin과 동일 원칙 — 자유 입력 금지). */
const COMMAND_OPTIONS = [
  { value: "turn_on", label: "전원 켜기 (turn_on)" },
  { value: "turn_off", label: "전원 끄기 (turn_off)" },
];

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "전체" },
  { value: "PENDING_APPROVAL", label: "승인 대기" },
  { value: "APPROVED", label: "승인됨" },
  { value: "REJECTED", label: "거절됨" },
  { value: "EXECUTED", label: "실행됨" },
  { value: "EXPIRED", label: "만료됨" },
  { value: "DISPATCH_FAILED", label: "발행 실패" },
];

const STATUS_LABEL: Record<RecommendationStatus, string> = {
  PENDING_APPROVAL: "승인 대기",
  APPROVED: "승인됨",
  REJECTED: "거절됨",
  EXECUTED: "실행됨",
  EXPIRED: "만료됨",
  // 승인은 됐지만 실제 제어 발행이 실패한 상태(코드 리뷰 P1 #4) — 아래 표에서 재시도 버튼을 보여준다.
  DISPATCH_FAILED: "발행 실패",
};

interface FormState {
  type: RecommendationType;
  targetId: string;
  proposedCommand: string;
  confidenceScore: string;
  modelVersion: string;
}

const INITIAL_FORM: FormState = {
  type: "ENERGY",
  targetId: "",
  proposedCommand: "",
  confidenceScore: "0.9",
  modelVersion: "",
};

/**
 * AI 추천 + HITL 승인 대기열 (SRS 3.5, PROJECT_RULES §9, M11).
 *
 * 이번 라운드는 안전 인프라(저장·게이트·승인/거절·감사·학습데이터)까지만 구축했다 — 실제
 * 이상행동 감지·에너지 절감 등 ML/휴리스틱 모델은 범위 밖이라, 위 생성 폼은 ADMIN이
 * 테스트/데모용으로 추천을 직접 만드는 용도다(2026-07-14 사용자 결정).
 * confidence < 0.8이거나 대상이 메인 차단기 성격의 감시장비(MONITORING_EQUIPMENT)면
 * 승인 대기로 들어간다 — 그 외(단일 조명 등 + confidence≥0.8)는 즉시 실행된다.
 */
export function RecommendationsAdmin(): JSX.Element {
  const [devices, setDevices] = useState<DeviceListItem[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [decidingId, setDecidingId] = useState<string | null>(null);

  // 필터를 빠르게 바꾸면 이전 필터의 응답이 나중에 도착해 최신 필터의 목록을 덮어쓸 수 있어
  // (statusFilter 변경 → reload 재호출 시점의 필터를 이 ref로 남겨 응답 반영 직전에 대조한다).
  const statusFilterRef = useRef(statusFilter);
  statusFilterRef.current = statusFilter;

  const reload = (): void => {
    const requestedFilter = statusFilter;
    listRecommendations(requestedFilter || undefined)
      .then((result) => {
        if (statusFilterRef.current !== requestedFilter) return;
        setRecommendations(result);
      })
      .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.detail : "추천 목록을 불러오지 못했습니다."));
  };

  useEffect(() => {
    listDevices()
      .then(setDevices)
      .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.detail : "기기 목록을 불러오지 못했습니다."));
  }, []);

  useEffect(reload, [statusFilter]);

  const updateForm = (patch: Partial<FormState>): void => {
    setForm((prev) => ({ ...prev, ...patch }));
    setFormError(null);
  };

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    setFormError(null);

    if (!form.targetId) {
      setFormError("대상 기기를 선택하세요.");
      return;
    }
    if (!form.proposedCommand) {
      setFormError("제안 명령을 선택하세요.");
      return;
    }
    const confidenceScore = Number(form.confidenceScore);
    if (Number.isNaN(confidenceScore) || confidenceScore < 0 || confidenceScore > 1) {
      setFormError("confidence는 0~1 사이 숫자여야 합니다.");
      return;
    }

    setSubmitting(true);
    createRecommendation({
      type: form.type,
      targetType: "DEVICE",
      targetId: form.targetId,
      proposedCommand: form.proposedCommand,
      confidenceScore,
      modelVersion: form.modelVersion.trim() || null,
    })
      .then(() => {
        setForm(INITIAL_FORM);
        reload();
      })
      .catch((err: unknown) => setFormError(err instanceof ApiError ? err.detail : "추천 생성에 실패했습니다."))
      .finally(() => setSubmitting(false));
  };

  const handleDecide = (id: string, decision: "APPROVE" | "REJECT"): void => {
    setDecidingId(id);
    setLoadError(null);
    decideRecommendation(id, { decision, reason: reasonById[id]?.trim() || null })
      .then(() => {
        setReasonById((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        reload();
      })
      .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.detail : "승인/거절에 실패했습니다."))
      .finally(() => setDecidingId(null));
  };

  const handleRetryDispatch = (id: string): void => {
    setDecidingId(id);
    setLoadError(null);
    retryRecommendationDispatch(id)
      .then(reload)
      .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.detail : "재시도에 실패했습니다."))
      .finally(() => setDecidingId(null));
  };

  const deviceName = (id: string): string => devices.find((d) => d.id === id)?.name ?? id;

  return (
    <div className="device-admin">
      <h2>AI 추천 · HITL 승인</h2>
      <p className="device-admin__note">
        confidence &lt; 0.8이거나 대상이 감시장비(메인 차단기 성격)면 승인 대기로 들어갑니다. 그 외는
        즉시 실행됩니다. 아래 생성 폼은 실제 AI 모델이 아니라 테스트/데모용입니다.
      </p>

      <form className="device-admin__form" onSubmit={handleSubmit}>
        <label>
          추천 유형
          <select value={form.type} onChange={(e) => updateForm({ type: e.target.value as RecommendationType })}>
            {RECOMMENDATION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          대상 기기
          <select value={form.targetId} onChange={(e) => updateForm({ targetId: e.target.value })}>
            <option value="">선택하세요</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.code})
              </option>
            ))}
          </select>
        </label>
        <label>
          제안 명령
          <select value={form.proposedCommand} onChange={(e) => updateForm({ proposedCommand: e.target.value })}>
            <option value="">선택하세요</option>
            {COMMAND_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          confidence (0~1)
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={form.confidenceScore}
            onChange={(e) => updateForm({ confidenceScore: e.target.value })}
          />
        </label>
        <label>
          모델 버전(선택)
          <input value={form.modelVersion} onChange={(e) => updateForm({ modelVersion: e.target.value })} />
        </label>
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? "생성 중…" : "추천 생성"}
        </button>
        {formError && <div className="error-text">{formError}</div>}
      </form>

      <label>
        상태 필터
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      {loadError && <p className="error-text">{loadError}</p>}

      <div className="device-admin__table-container">
      <table className="device-admin__table">
        <thead>
          <tr>
            <th>유형</th>
            <th>대상</th>
            <th>제안 명령</th>
            <th>confidence</th>
            <th>승인필요</th>
            <th>상태</th>
            <th>생성 시각</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {recommendations.map((r) => (
            <tr key={r.id}>
              <td>{RECOMMENDATION_TYPES.find((t) => t.value === r.type)?.label ?? r.type}</td>
              <td>{deviceName(r.targetId)}</td>
              <td>{r.proposedCommand}</td>
              <td>{r.confidenceScore.toFixed(2)}</td>
              <td>
                <span className={r.requiresHitl ? "status-chip status-chip--simulated" : "status-chip status-chip--ok"}>
                  {r.requiresHitl ? "필요" : "불필요"}
                </span>
              </td>
              <td>{STATUS_LABEL[r.status]}</td>
              <td>{new Date(r.createdAt).toLocaleString()}</td>
              <td>
                {r.status === "PENDING_APPROVAL" && (
                  <div className="device-admin__form" style={{ display: "inline-flex", gap: "0.4rem" }}>
                    <input
                      placeholder="사유(선택)"
                      value={reasonById[r.id] ?? ""}
                      onChange={(e) => setReasonById((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    />
                    <button
                      type="button"
                      className="primary"
                      onClick={() => handleDecide(r.id, "APPROVE")}
                      disabled={decidingId === r.id}
                    >
                      승인
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => handleDecide(r.id, "REJECT")}
                      disabled={decidingId === r.id}
                    >
                      거절
                    </button>
                  </div>
                )}
                {r.status === "DISPATCH_FAILED" && (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => handleRetryDispatch(r.id)}
                    disabled={decidingId === r.id}
                  >
                    {decidingId === r.id ? "재시도 중…" : "발행 재시도"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
