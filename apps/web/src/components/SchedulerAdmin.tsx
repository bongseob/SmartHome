import { Fragment, useEffect, useState, type FormEvent } from "react";
import type { ScheduleType, TargetType } from "@smarthome/contracts";
import {
  ApiError,
  createScheduler,
  deleteScheduler,
  getSchedulerRuns,
  listDevices,
  listSchedulers,
  setSchedulerEnabled,
} from "../lib/api";
import type { CreateSchedulerRequest, DeviceListItem, ScheduleRunRecord, SchedulerRecord } from "../lib/types";

const SCHEDULE_TYPES: ScheduleType[] = ["ONE_TIME", "DAILY", "WEEKLY", "MONTHLY", "CRON"];
const TARGET_TYPES: TargetType[] = ["DEVICE", "GROUP", "AREA"];
const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

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
function timeToUtcIso(time: string): string {
  return new Date(`1970-01-01T${time}:00Z`).toISOString();
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
};

export function SchedulerAdmin(): JSX.Element {
  const [schedulers, setSchedulers] = useState<SchedulerRecord[]>([]);
  const [devices, setDevices] = useState<DeviceListItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
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
  }, []);

  const handleToggleEnabled = (s: SchedulerRecord) => {
    setSchedulers((prev) => prev.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)));
    setSchedulerEnabled(s.id, !s.enabled).catch((err: unknown) => {
      setLoadError(err instanceof ApiError ? err.detail : "상태 변경에 실패했습니다.");
      reload();
    });
  };

  const handleDelete = (s: SchedulerRecord) => {
    if (!window.confirm(`'${s.name}' 스케줄을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    deleteScheduler(s.id)
      .then(() => setSchedulers((prev) => prev.filter((x) => x.id !== s.id)))
      .catch((err: unknown) => {
        setLoadError(err instanceof ApiError ? err.detail : "삭제에 실패했습니다.");
      });
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

  const toggleWeekday = (day: number) => {
    setForm((prev) => ({
      ...prev,
      daysOfWeek: prev.daysOfWeek.includes(day)
        ? prev.daysOfWeek.filter((d) => d !== day)
        : [...prev.daysOfWeek, day].sort(),
    }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!form.name.trim() || !form.targetId.trim() || !form.command.trim()) {
      setFormError("이름, 대상 ID, 명령은 필수입니다.");
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
    };

    if (form.scheduleType === "ONE_TIME") {
      if (!form.oneTimeAt) {
        setFormError("발화 시각을 입력하세요.");
        return;
      }
      body.runAt = new Date(form.oneTimeAt).toISOString();
    } else if (form.scheduleType === "DAILY") {
      body.runAt = timeToUtcIso(form.timeOfDay);
    } else if (form.scheduleType === "WEEKLY") {
      if (form.daysOfWeek.length === 0) {
        setFormError("반복할 요일을 하나 이상 선택하세요.");
        return;
      }
      body.runAt = timeToUtcIso(form.timeOfDay);
      body.daysOfWeek = form.daysOfWeek;
    } else if (form.scheduleType === "MONTHLY") {
      body.runAt = timeToUtcIso(form.timeOfDay);
      body.dayOfMonth = form.dayOfMonth;
    } else if (form.scheduleType === "CRON") {
      if (!form.cronExpr.trim()) {
        setFormError("cron 식을 입력하세요.");
        return;
      }
      body.cronExpr = form.cronExpr.trim();
    }

    setSubmitting(true);
    createScheduler(body)
      .then((created) => {
        setSchedulers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
        setShowForm(false);
        setForm(INITIAL_FORM);
      })
      .catch((err: unknown) => {
        setFormError(err instanceof ApiError ? err.detail : "스케줄 생성에 실패했습니다.");
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <div className="scheduler-admin">
      <div className="scheduler-admin__header">
        <h2>스케줄 / 예약 관리</h2>
        <button type="button" className="primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "닫기" : "+ 새 스케줄"}
        </button>
      </div>

      {loadError && <p className="error-text">{loadError}</p>}

      {showForm && (
        <form className="scheduler-form" onSubmit={handleSubmit}>
          <label>
            이름
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>

          <div className="scheduler-form__row">
            <label>
              대상 종류
              <select
                value={form.targetType}
                onChange={(e) => setForm({ ...form, targetType: e.target.value as TargetType, targetId: "" })}
              >
                {TARGET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>

            {form.targetType === "DEVICE" ? (
              <label>
                대상 기기
                <select value={form.targetId} onChange={(e) => setForm({ ...form, targetId: e.target.value })}>
                  <option value="">선택하세요</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                대상 ID
                <input
                  value={form.targetId}
                  onChange={(e) => setForm({ ...form, targetId: e.target.value })}
                  placeholder={`${form.targetType} id`}
                />
              </label>
            )}
          </div>

          <label>
            반복 방식
            <select
              value={form.scheduleType}
              onChange={(e) => setForm({ ...form, scheduleType: e.target.value as ScheduleType })}
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
                onChange={(e) => setForm({ ...form, oneTimeAt: e.target.value })}
              />
            </label>
          )}

          {(form.scheduleType === "DAILY" || form.scheduleType === "WEEKLY" || form.scheduleType === "MONTHLY") && (
            <label>
              시각 (UTC)
              <input
                type="time"
                value={form.timeOfDay}
                onChange={(e) => setForm({ ...form, timeOfDay: e.target.value })}
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
                onChange={(e) => setForm({ ...form, dayOfMonth: Number(e.target.value) })}
              />
            </label>
          )}

          {form.scheduleType === "CRON" && (
            <label>
              cron 식
              <input
                value={form.cronExpr}
                onChange={(e) => setForm({ ...form, cronExpr: e.target.value })}
                placeholder="0 9 * * 1-5"
              />
            </label>
          )}

          <div className="scheduler-form__row">
            <label>
              명령(command)
              <input
                value={form.command}
                onChange={(e) => setForm({ ...form, command: e.target.value })}
                placeholder="turn_on"
              />
            </label>
            <label>
              args (JSON, 선택)
              <input
                value={form.argsJson}
                onChange={(e) => setForm({ ...form, argsJson: e.target.value })}
                placeholder='{"level": 3}'
              />
            </label>
          </div>

          {formError && <p className="error-text">{formError}</p>}

          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? "생성 중…" : "생성"}
          </button>
        </form>
      )}

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
                <td>
                  {s.targetType} · {s.targetId.slice(0, 8)}
                </td>
                <td>{summarizeSchedule(s)}</td>
                <td>{s.payload.command ?? "-"}</td>
                <td>
                  <button
                    type="button"
                    className={s.enabled ? "active" : ""}
                    onClick={() => handleToggleEnabled(s)}
                  >
                    {s.enabled ? "ON" : "OFF"}
                  </button>
                </td>
                <td className="scheduler-table__actions">
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
  );
}
