import { Fragment, useEffect, useState, type FormEvent } from "react";
import type { ScheduleType, TargetType } from "@smarthome/contracts";
import {
  ApiError,
  createScheduler,
  deleteScheduler,
  getSchedulerRuns,
  listDevices,
  listSchedulers,
  listGroupControlSummaries,
  setSchedulerEnabled,
  updateScheduler,
} from "../lib/api";
import type { CreateSchedulerRequest, DeviceListItem, GroupControlSummary, ScheduleRunRecord, SchedulerRecord } from "../lib/types";
import { useConfirm } from "./ConfirmDialog";

const SCHEDULE_TYPES: ScheduleType[] = ["ONE_TIME", "DAILY", "WEEKLY", "MONTHLY", "CRON"];
const TARGET_TYPES: TargetType[] = ["DEVICE", "GROUP", "AREA"];
const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
/** 현재 기기/그룹 제어에서 실제로 지원하는 명령만 노출한다(오타 방지 — 자유 입력 금지). */
const COMMAND_OPTIONS: { value: string; label: string }[] = [
  { value: "turn_on", label: "전원 켜기 (turn_on)" },
  { value: "turn_off", label: "전원 끄기 (turn_off)" },
];

function summarizeSchedule(s: SchedulerRecord): string {
  const time = s.runAt ? new Date(s.runAt).toISOString().slice(11, 16) : "--:--";
  switch (s.scheduleType) {
    case "ONE_TIME":
      return s.runAt ? `1회 · ${new Date(s.runAt).toLocaleString()}` : "1회 · 미설정";
    case "DAILY":
      return `매일 ${time} (UTC)`;
    case "WEEKLY": {
      const days = (s.daysOfWeek ?? []).map((d) => WEEKDAY_LABELS[d]).join(",");
      return `매주 ${days || "?"} ${time} (UTC)`;
    }
    case "MONTHLY":
      return `매월 ${s.dayOfMonth ?? "?"}일 ${time} (UTC)`;
    case "CRON":
      return `cron: ${s.cronExpr ?? ""}`;
    default:
      return s.scheduleType;
  }
}

/** "HH:MM" 입력을 UTC 시각으로 해석해 임의의 기준일 ISO 문자열로 만든다(schedule-math.ts는 시:분:초만 사용). */
function timeToUtcIso(time: string): string | null {
  let clean = time.trim();
  let isPM = false;
  if (/오후|pm/i.test(clean)) {
    isPM = true;
  }
  clean = clean.replace(/오전|오후|am|pm|시|분|초/gi, "").trim();

  const match = clean.match(/(\d{1,2})[\s:]*(\d{2})?/);
  if (!match) return null;

  let hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);

  if (isPM && hours < 12) {
    hours += 12;
  } else if (!isPM && hours === 12) {
    hours = 0;
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  const paddedH = String(hours).padStart(2, "0");
  const paddedM = String(minutes).padStart(2, "0");

  const isoStr = `1970-01-01T${paddedH}:${paddedM}:00Z`;
  const d = new Date(isoStr);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** datetime-local input은 로컬 시각 문자열을 쓴다 — handleSubmit의 `new Date(form.oneTimeAt)`과 대칭. */
function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** DAILY/WEEKLY/MONTHLY의 runAt은 UTC 시:분만 의미가 있다(timeToUtcIso와 대칭). */
function isoToUtcTimeOfDay(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function formFromScheduler(s: SchedulerRecord): FormState {
  const hasRepeatingTime = s.scheduleType === "DAILY" || s.scheduleType === "WEEKLY" || s.scheduleType === "MONTHLY";
  return {
    name: s.name,
    targetType: s.targetType,
    targetId: s.targetId,
    scheduleType: s.scheduleType,
    oneTimeAt: s.scheduleType === "ONE_TIME" && s.runAt ? isoToDatetimeLocal(s.runAt) : "",
    timeOfDay: hasRepeatingTime && s.runAt ? isoToUtcTimeOfDay(s.runAt) : "09:00",
    daysOfWeek: s.daysOfWeek ?? [],
    dayOfMonth: s.dayOfMonth ?? 1,
    cronExpr: s.cronExpr ?? "",
    command: s.payload.command ?? "",
    argsJson: s.payload.args ? JSON.stringify(s.payload.args) : "",
    catchUpEnabled: s.catchUpEnabled,
  };
}

/** 대상 셀 — DEVICE/GROUP은 이름을 찾아 보여주고 클릭하면 그 대상의 관제 화면으로 이동한다.
 * AREA는 스케줄 fan-out 자체가 아직 지원되지 않아(§M10) 이동 없이 표시만 한다. */
function renderTarget(
  s: SchedulerRecord,
  devices: DeviceListItem[],
  groups: GroupControlSummary[],
  onNavigateToDevice?: (device: DeviceListItem) => void,
  onNavigateToGroup?: (groupId: string) => void,
): JSX.Element {
  if (s.targetType === "DEVICE") {
    const device = devices.find((d) => d.id === s.targetId);
    const label = device ? `${device.name} (${device.code})` : `DEVICE · ${s.targetId.slice(0, 8)}`;
    if (device && onNavigateToDevice) {
      return (
        <button type="button" className="scheduler-table__target-link" onClick={() => onNavigateToDevice(device)}>
          {label}
        </button>
      );
    }
    return <span>{label}</span>;
  }
  if (s.targetType === "GROUP") {
    const group = groups.find((g) => g.id === s.targetId);
    const label = group ? group.name : `GROUP · ${s.targetId.slice(0, 8)}`;
    if (onNavigateToGroup) {
      return (
        <button
          type="button"
          className="scheduler-table__target-link"
          onClick={() => onNavigateToGroup(s.targetId)}
        >
          {label}
        </button>
      );
    }
    return <span>{label}</span>;
  }
  return (
    <span>
      {s.targetType} · {s.targetId.slice(0, 8)}
    </span>
  );
}

interface FormState {
  name: string;
  targetType: TargetType;
  targetId: string;
  scheduleType: ScheduleType;
  oneTimeAt: string; // datetime-local
  timeOfDay: string; // HH:MM
  daysOfWeek: number[];
  dayOfMonth: number;
  cronExpr: string;
  command: string;
  argsJson: string;
  /** true면 다운타임 중 놓친 발화도 재기동 후 최대 10분까지 실행한다(기본 false=cron과 동일). */
  catchUpEnabled: boolean;
}

const INITIAL_FORM: FormState = {
  name: "",
  targetType: "DEVICE",
  targetId: "",
  scheduleType: "ONE_TIME",
  oneTimeAt: "",
  timeOfDay: "09:00",
  daysOfWeek: [],
  dayOfMonth: 1,
  cronExpr: "",
  command: "",
  argsJson: "",
  catchUpEnabled: false,
};

interface SchedulerAdminProps {
  /** 대상(DEVICE) 클릭 시 그 기기의 관제(Floor Map) 화면으로 이동 요청 — App이 층 해석까지 담당한다. */
  onNavigateToDevice?: (device: DeviceListItem) => void;
  /** 대상(GROUP) 클릭 시 그룹별 제어 화면에서 해당 그룹을 펼쳐 보여달라는 요청. */
  onNavigateToGroup?: (groupId: string) => void;
}

export function SchedulerAdmin({ onNavigateToDevice, onNavigateToGroup }: SchedulerAdminProps): JSX.Element {
  const confirm = useConfirm();
  const [schedulers, setSchedulers] = useState<SchedulerRecord[]>([]);
  const [devices, setDevices] = useState<DeviceListItem[]>([]);
  const [groups, setGroups] = useState<GroupControlSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [runsFor, setRunsFor] = useState<string | null>(null);
  const [runs, setRuns] = useState<ScheduleRunRecord[]>([]);
  const [runsError, setRunsError] = useState<string | null>(null);

  const reload = () => {
    listSchedulers()
      .then((result) => {
        setSchedulers(result);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof ApiError ? err.detail : "스케줄 목록을 불러오지 못했습니다.");
      });
  };

  useEffect(() => {
    reload();
    listDevices()
      .then(setDevices)
      .catch(() => undefined);
    listGroupControlSummaries()
      .then(setGroups)
      .catch(() => undefined);
  }, []);

  const handleToggleEnabled = (s: SchedulerRecord) => {
    setSchedulers((prev) => prev.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)));
    setSchedulerEnabled(s.id, !s.enabled).catch((err: unknown) => {
      setLoadError(err instanceof ApiError ? err.detail : "상태 변경에 실패했습니다.");
      reload();
    });
  };

  const handleDelete = (s: SchedulerRecord) => {
    confirm(`'${s.name}' 스케줄을 삭제할까요? 되돌릴 수 없습니다.`, { danger: true }).then((ok) => {
      if (!ok) return;
      deleteScheduler(s.id)
        .then(() => setSchedulers((prev) => prev.filter((x) => x.id !== s.id)))
        .catch((err: unknown) => {
          setLoadError(err instanceof ApiError ? err.detail : "삭제에 실패했습니다.");
        });
    });
  };

  const handleEdit = (s: SchedulerRecord) => {
    setEditingId(s.id);
    setForm(formFromScheduler(s));
    setFormError(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
  };

  const handleShowRuns = (s: SchedulerRecord) => {
    if (runsFor === s.id) {
      setRunsFor(null);
      return;
    }
    setRunsFor(s.id);
    setRuns([]);
    setRunsError(null);
    getSchedulerRuns(s.id)
      .then(setRuns)
      .catch((err: unknown) => {
        setRunsError(err instanceof ApiError ? err.detail : "실행 이력을 불러오지 못했습니다.");
      });
  };

  /** 폼 필드 갱신 + 이전 검증 에러 메시지 초기화(입력을 고쳤는데 옛 에러가 남아있는 것을 방지). */
  const updateForm = (patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setFormError(null);
  };

  const toggleWeekday = (day: number) => {
    setForm((prev) => ({
      ...prev,
      daysOfWeek: prev.daysOfWeek.includes(day)
        ? prev.daysOfWeek.filter((d) => d !== day)
        : [...prev.daysOfWeek, day].sort(),
    }));
    setFormError(null);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!form.name.trim()) {
      setFormError("이름은 필수입니다.");
      return;
    }
    if (!form.targetId.trim()) {
      setFormError(
        form.targetType === "DEVICE"
          ? "대상 기기를 선택하세요."
          : form.targetType === "GROUP"
            ? "대상 그룹을 선택하세요."
            : "대상 ID를 입력하세요.",
      );
      return;
    }
    if (!form.command.trim()) {
      setFormError("명령(command)은 필수입니다.");
      return;
    }

    let args: Record<string, unknown> | undefined;
    if (form.argsJson.trim()) {
      try {
        args = JSON.parse(form.argsJson) as Record<string, unknown>;
      } catch {
        setFormError("args는 올바른 JSON이어야 합니다.");
        return;
      }
    }

    const body: CreateSchedulerRequest = {
      name: form.name.trim(),
      targetType: form.targetType,
      targetId: form.targetId,
      scheduleType: form.scheduleType,
      payload: { command: form.command.trim(), ...(args ? { args } : {}) },
      catchUpEnabled: form.catchUpEnabled,
    };

    if (form.scheduleType === "ONE_TIME") {
      if (!form.oneTimeAt) {
        setFormError("발화 시각을 입력하세요.");
        return;
      }
      const parsedDate = new Date(form.oneTimeAt);
      if (Number.isNaN(parsedDate.getTime())) {
        setFormError("올바르지 않은 발화 시각 형식입니다. 날짜와 시각을 정확히 입력해 주세요.");
        return;
      }
      body.runAt = parsedDate.toISOString();
    } else if (form.scheduleType === "DAILY" || form.scheduleType === "WEEKLY" || form.scheduleType === "MONTHLY") {
      const utcIso = timeToUtcIso(form.timeOfDay);
      if (!utcIso) {
        setFormError("올바르지 않은 시각 형식입니다. 시각을 정확히 입력해 주세요.");
        return;
      }
      body.runAt = utcIso;

      if (form.scheduleType === "WEEKLY") {
        if (form.daysOfWeek.length === 0) {
          setFormError("반복할 요일을 하나 이상 선택하세요.");
          return;
        }
        body.daysOfWeek = form.daysOfWeek;
      } else if (form.scheduleType === "MONTHLY") {
        body.dayOfMonth = form.dayOfMonth;
      }
    } else if (form.scheduleType === "CRON") {
      if (!form.cronExpr.trim()) {
        setFormError("cron 식을 입력하세요.");
        return;
      }
      body.cronExpr = form.cronExpr.trim();
    }

    setSubmitting(true);
    const request = editingId ? updateScheduler(editingId, body) : createScheduler(body);
    request
      .then((saved) => {
        setSchedulers((prev) => {
          const next = editingId ? prev.map((x) => (x.id === saved.id ? saved : x)) : [...prev, saved];
          return next.sort((a, b) => a.name.localeCompare(b.name));
        });
        closeForm();
        setForm(INITIAL_FORM);
      })
      .catch((err: unknown) => {
        setFormError(
          err instanceof ApiError ? err.detail : `스케줄 ${editingId ? "수정" : "생성"}에 실패했습니다.`,
        );
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <div className="scheduler-admin">
      <div className="scheduler-admin__header" style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "1rem" }}>
        <h2>스케줄 / 예약 관리</h2>
        <button
          type="button"
          className="primary"
          onClick={() => {
            setEditingId(null);
            setForm(INITIAL_FORM);
            setShowForm(true);
          }}
        >
          + 새 스케줄
        </button>
      </div>

      {loadError && <p className="error-text">{loadError}</p>}

      {/* ─── 새 스케줄 등록 모달 ─── */}
      {showForm && (
        <div className="modal-overlay">
          <form className="modal-content" onSubmit={handleSubmit}>
            <h3>{editingId ? "스케줄 수정" : "새 스케줄 예약 등록"}</h3>
            <div className="device-admin__form">
              <label>
                이름
                <input value={form.name} onChange={(e) => updateForm({ name: e.target.value })} />
              </label>

              <div className="scheduler-form__row">
                <label>
                  대상 종류
                  <select
                    value={form.targetType}
                    onChange={(e) => updateForm({ targetType: e.target.value as TargetType, targetId: "" })}
                  >
                    {TARGET_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>

                {form.targetType === "DEVICE" && (
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
                )}

                {form.targetType === "GROUP" && (
                  <label>
                    대상 그룹
                    <select value={form.targetId} onChange={(e) => updateForm({ targetId: e.target.value })}>
                      <option value="">선택하세요</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} ({g.slug})
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {form.targetType === "AREA" && (
                  <label>
                    대상 ID
                    <input
                      value={form.targetId}
                      onChange={(e) => updateForm({ targetId: e.target.value })}
                      placeholder="공간(Area) ID (UUID)"
                    />
                  </label>
                )}
              </div>

              <label>
                반복 방식
                <select
                  value={form.scheduleType}
                  onChange={(e) => updateForm({ scheduleType: e.target.value as ScheduleType })}
                >
                  {SCHEDULE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              {form.scheduleType === "ONE_TIME" && (
                <label>
                  발화 시각
                  <input
                    type="datetime-local"
                    value={form.oneTimeAt}
                    onChange={(e) => updateForm({ oneTimeAt: e.target.value })}
                  />
                </label>
              )}

              {(form.scheduleType === "DAILY" || form.scheduleType === "WEEKLY" || form.scheduleType === "MONTHLY") && (
                <label>
                  시각 (UTC)
                  <input
                    type="time"
                    value={form.timeOfDay}
                    onChange={(e) => updateForm({ timeOfDay: e.target.value })}
                  />
                </label>
              )}

              {form.scheduleType === "WEEKLY" && (
                <div className="scheduler-form__weekdays">
                  {WEEKDAY_LABELS.map((label, day) => (
                    <button
                      key={day}
                      type="button"
                      className={form.daysOfWeek.includes(day) ? "active" : ""}
                      onClick={() => toggleWeekday(day)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {form.scheduleType === "MONTHLY" && (
                <label>
                  매월 며칠
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={form.dayOfMonth}
                    onChange={(e) => updateForm({ dayOfMonth: Number(e.target.value) })}
                  />
                </label>
              )}

              {form.scheduleType === "CRON" && (
                <label>
                  cron 식
                  <input
                    value={form.cronExpr}
                    onChange={(e) => updateForm({ cronExpr: e.target.value })}
                    placeholder="0 9 * * 1-5"
                  />
                </label>
              )}

              <div className="scheduler-form__row">
                <label>
                  명령(command)
                  <select value={form.command} onChange={(e) => updateForm({ command: e.target.value })}>
                    <option value="">선택하세요</option>
                    {COMMAND_OPTIONS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  args (JSON, 선택)
                  <input
                    value={form.argsJson}
                    onChange={(e) => updateForm({ argsJson: e.target.value })}
                    placeholder='{"level": 3}'
                  />
                </label>
              </div>

              <label className="scheduler-form__checkbox">
                <input
                  type="checkbox"
                  checked={form.catchUpEnabled}
                  onChange={(e) => updateForm({ catchUpEnabled: e.target.checked })}
                />
                다운타임 중 놓친 발화도 재기동 후 최대 10분까지 실행(캐치업 허용)
              </label>
              <p className="scheduler-form__hint">
                기본(꺼짐)은 리눅스 cron과 동일하게 동작합니다 — 시스템이 꺼져 있던 동안 지나간
                예약은 재기동해도 실행하지 않고 건너뜁니다(SKIPPED). 사람이 "이미 실행됐거나 아예
                실행 안 됐겠지"라고 가정하는 시점에 장비가 예기치 않게 상태를 바꾸는 걸 막기 위한
                기본값이니, 정말 필요한 경우에만 켜세요.
              </p>
            </div>

            {formError && <p className="error-text">{formError}</p>}

            <div className="modal-actions">
              <button type="submit" className="primary" disabled={submitting}>
                {submitting ? (editingId ? "저장 중…" : "생성 중…") : editingId ? "저장" : "생성"}
              </button>
              <button type="button" onClick={closeForm}>
                취소
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ─── 스케줄 목록 테이블 ─── */}
      <div className="scheduler-table-container">
        <table className="scheduler-table">
          <thead>
            <tr>
              <th>이름</th>
              <th>대상</th>
              <th>일정</th>
              <th>명령</th>
              <th>활성</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {schedulers.map((s) => (
              <Fragment key={s.id}>
                <tr>
                  <td>{s.name}</td>
                  <td>{renderTarget(s, devices, groups, onNavigateToDevice, onNavigateToGroup)}</td>
                  <td>
                    {summarizeSchedule(s)}
                    {s.catchUpEnabled && (
                      <span
                        className="status-chip status-chip--muted"
                        title="다운타임 중 놓친 발화도 재기동 후 최대 10분까지 실행합니다(기본값 아님)."
                        style={{ marginLeft: "0.4rem" }}
                      >
                        캐치업 10분
                      </span>
                    )}
                  </td>
                  <td>{s.payload.command ?? "-"}</td>
                  <td>
                    <button
                      type="button"
                      className={`scheduler-toggle ${s.enabled ? "scheduler-toggle--on" : "scheduler-toggle--off"}`}
                      onClick={() => handleToggleEnabled(s)}
                    >
                      {s.enabled ? "ON" : "OFF"}
                    </button>
                  </td>
                  <td className="scheduler-table__actions">
                    <button type="button" onClick={() => handleEdit(s)}>
                      수정
                    </button>
                    <button type="button" onClick={() => handleShowRuns(s)}>
                      이력
                    </button>
                    <button type="button" onClick={() => handleDelete(s)}>
                      삭제
                    </button>
                  </td>
                </tr>
                {runsFor === s.id && (
                  <tr>
                    <td colSpan={6} className="scheduler-table__runs">
                      {runsError && <p className="error-text">{runsError}</p>}
                      {!runsError && runs.length === 0 && <span>실행 이력이 없습니다.</span>}
                      {!runsError && runs.length > 0 && (
                        <ul>
                          {runs.map((r) => (
                            <li key={r.id}>
                              {new Date(r.firedAt).toLocaleString()} · {r.status}
                              {r.commandId ? ` · command ${r.commandId.slice(0, 8)}` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
