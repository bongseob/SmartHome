import { useEffect, useRef, type FormEvent } from "react";
import type { AlarmRecord } from "../lib/types";
import { SEVERITY_COLOR } from "../lib/status";

/** Snooze 시간 선택지(분) — SRS/UI 목업(§4.5)에 구체적 옵션이 명시돼 있지 않아 실무에서
 *  흔한 구간(10분/30분/1시간/3시간)으로 정했다. */
const SNOOZE_MINUTES_OPTIONS = [10, 30, 60, 180];

interface AlarmBannerProps {
  alarms: AlarmRecord[];
  onAck: (id: string) => void;
  /** Snooze(USER, §4.5) — 지정한 분(minutes) 동안 재알림을 억제한다. */
  onSnooze: (id: string, minutes: number) => void;
  /** deviceId → 표시용 이름(없으면 메시지/ID로 대체). */
  resolveDeviceName?: (deviceId: string | null) => string | null;
  /** "📷현장" 버튼 — 지정하면 알람 행마다 노출(§5-cam 현장 확인). */
  onOpenCameras?: (alarmId: string) => void;
  /** "기기로 이동" 버튼 — 지정하면 알람 행마다 노출, 관제 화면에서 해당 기기를 바로 선택한다. */
  onNavigateToDevice?: (deviceId: string) => void;
}

/** 짧은 경보음(Web Audio). 자동재생 제한이 있으면 조용히 무시된다. */
function beep(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
    osc.onended = () => void ctx.close();
  } catch {
    // 오디오 사용 불가 — 무시(시각 알림으로 충분)
  }
}

/**
 * 미확인 알람 배너 — 현장 상태변화 등으로 발생한 RAISED 알람을 지속적으로 표시(펄스+경보음)한다.
 * 담당자/관리자가 '확인'을 눌러야만 해당 알람이 멈춘다(자동 해제 없음).
 */
export function AlarmBanner({
  alarms,
  onAck,
  onSnooze,
  resolveDeviceName,
  onOpenCameras,
  onNavigateToDevice,
}: AlarmBannerProps): JSX.Element | null {
  const prevCount = useRef(0);

  useEffect(() => {
    if (alarms.length > prevCount.current) beep();
    prevCount.current = alarms.length;
  }, [alarms.length]);

  if (alarms.length === 0) return null;

  return (
    <div className="alarm-banner" role="alert" aria-live="assertive">
      <div className="alarm-banner__head">
        <span className="alarm-banner__pulse" aria-hidden="true" />
        <strong>미확인 알람 {alarms.length}건</strong>
        <span className="alarm-banner__hint">담당자/관리자가 ‘확인’을 눌러야 멈춥니다.</span>
        {alarms.length > 1 && (
          <button
            type="button"
            className="alarm-banner__ackall"
            onClick={() => alarms.forEach((alarm) => onAck(alarm.id))}
          >
            모두 확인
          </button>
        )}
      </div>
      <ul className="alarm-banner__list">
        {alarms.map((alarm) => {
          const name = resolveDeviceName?.(alarm.deviceId) ?? null;
          return (
            <li key={alarm.id} className="alarm-banner__item">
              <span
                className="alarm-banner__sev"
                style={{ background: SEVERITY_COLOR[alarm.severity] }}
              >
                {alarm.severity}
              </span>
              <span className="alarm-banner__msg">
                {name ? <strong>{name}</strong> : null}
                {alarm.message ?? "현장 상태 변화"}
              </span>
              <time className="alarm-banner__time">
                {new Date(alarm.raisedAt).toLocaleTimeString()}
              </time>
              {onNavigateToDevice && alarm.deviceId && (
                <button
                  type="button"
                  className="alarm-banner__ack"
                  onClick={() => onNavigateToDevice(alarm.deviceId as string)}
                >
                  🎯기기로 이동
                </button>
              )}
              {onOpenCameras && (
                <button type="button" className="alarm-banner__ack" onClick={() => onOpenCameras(alarm.id)}>
                  📷현장
                </button>
              )}
              <button type="button" className="alarm-banner__ack" onClick={() => onAck(alarm.id)}>
                확인
              </button>
              <form
                className="alarm-banner__snooze"
                onSubmit={(e: FormEvent<HTMLFormElement>) => {
                  e.preventDefault();
                  const minutes = Number(new FormData(e.currentTarget).get("minutes"));
                  onSnooze(alarm.id, minutes);
                }}
              >
                <select name="minutes" defaultValue={SNOOZE_MINUTES_OPTIONS[1]} aria-label="Snooze 시간(분)">
                  {SNOOZE_MINUTES_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m}분
                    </option>
                  ))}
                </select>
                <button type="submit" className="alarm-banner__ack">
                  Snooze
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
