import type { ExecutionStatus } from "@smarthome/contracts";
import type { DeviceHistory, DeviceListItem } from "../lib/types";
import { DEVICE_STATUS_COLOR } from "../lib/status";

interface PendingCommand {
  commandId: string;
  status: ExecutionStatus;
}

interface DeviceDrawerProps {
  device: DeviceListItem;
  history: DeviceHistory | null;
  historyError: string | null;
  pendingCommand: PendingCommand | null;
  onClose: () => void;
  onSendCommand: (command: "turn_on" | "turn_off") => void;
  /** 편집 모드에서는 오조작 방지를 위해 제어를 비활성화한다(ui-ux-design.md §4.1-mode). */
  editMode?: boolean;
}

function historyLine(item: Record<string, unknown>): string {
  const ts = String(item.createdAt ?? item.ts ?? item.raisedAt ?? "");
  const time = ts ? new Date(ts).toLocaleTimeString() : "";
  if (item.kind === "COMMAND") {
    return `${time} 명령 ${item.command} → ${item.status}`;
  }
  if (item.kind === "AUDIT") {
    return `${time} [감사] ${item.actorType} ${item.command ?? ""} ${item.executionStatus ?? ""}`;
  }
  return `${time} [알람] ${item.tier} ${item.severity} ${item.message ?? ""}`;
}

export function DeviceDrawer({
  device,
  history,
  historyError,
  pendingCommand,
  onClose,
  onSendCommand,
  editMode = false,
}: DeviceDrawerProps): JSX.Element {
  const timeline = history
    ? [...history.commands, ...history.audits, ...history.alarms]
        .map((item) => item as Record<string, unknown>)
        .sort((a, b) => {
          const at = new Date(String(a.createdAt ?? a.ts ?? a.raisedAt ?? 0)).getTime();
          const bt = new Date(String(b.createdAt ?? b.ts ?? b.raisedAt ?? 0)).getTime();
          return bt - at;
        })
        .slice(0, 15)
    : [];

  return (
    <aside className="device-drawer">
      <header>
        <h2>{device.name}</h2>
        <button type="button" onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </header>
      <p className="device-drawer__code">{device.code}</p>
      <p>
        상태{" "}
        <span
          className="status-badge"
          style={{ backgroundColor: DEVICE_STATUS_COLOR[device.currentStatus] }}
        >
          {device.currentStatus}
        </span>
      </p>
      <div className="device-drawer__actions">
        <button type="button" disabled={editMode} onClick={() => onSendCommand("turn_on")}>
          ON
        </button>
        <button type="button" disabled={editMode} onClick={() => onSendCommand("turn_off")}>
          OFF
        </button>
      </div>
      {editMode && <p className="device-drawer__edit-note">편집 모드 — 제어 비활성화(위치만 이동 가능)</p>}
      {pendingCommand && (
        <p className="device-drawer__pending">
          명령 {pendingCommand.commandId.slice(0, 12)}… → {pendingCommand.status}
        </p>
      )}
      <h3>최근 이력</h3>
      {historyError && <p className="error-text">{historyError}</p>}
      <ul className="device-drawer__history">
        {timeline.map((item, index) => (
          // 서버가 안정적인 고유 id를 내려주지 않아 인덱스를 함께 키로 사용한다.
          <li key={`${String(item.commandId ?? item.logId ?? item.alarmId ?? "row")}-${index}`}>
            {historyLine(item)}
          </li>
        ))}
        {timeline.length === 0 && !historyError && <li>이력 없음</li>}
      </ul>
    </aside>
  );
}
