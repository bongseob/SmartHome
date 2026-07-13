import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { getSystemStatus, type SystemStatus } from "../lib/api";

type ServiceKey = "web" | "api" | "mqtt" | "redis" | "gateway" | "scheduler" | "simulator";

const SERVICE_LABELS: Record<ServiceKey, string> = {
  web: "Web",
  api: "API",
  mqtt: "MQTT",
  redis: "Redis",
  gateway: "Gateway",
  scheduler: "Scheduler",
  simulator: "Simulator",
};

const SERVICE_KEYS = Object.keys(SERVICE_LABELS) as ServiceKey[];

// 헤더/네비게이션 바(대략 140px 높이)와 겹치지 않도록 그 아래에 배치한다 —
// 겹치면 오버레이가 열린 동안 관리자 네비 버튼 클릭이 막힌다.
const DEFAULT_POSITION = { top: 170, left: 24 };

const POLL_INTERVAL_MS = 5000;
const POSITION_STORAGE_KEY = "smarthome:serverStatusBoxPosition";

type Position = { top: number; left: number };

function loadPosition(): Position {
  try {
    const raw = window.localStorage.getItem(POSITION_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_POSITION };
    const parsed = JSON.parse(raw) as Partial<Position>;
    return {
      top: typeof parsed.top === "number" ? parsed.top : DEFAULT_POSITION.top,
      left: typeof parsed.left === "number" ? parsed.left : DEFAULT_POSITION.left,
    };
  } catch {
    return { ...DEFAULT_POSITION };
  }
}

interface DragState {
  pointerStartX: number;
  pointerStartY: number;
  boxStartTop: number;
  boxStartLeft: number;
}

interface ServerStatusOverlayProps {
  open: boolean;
  onClose: () => void;
}

/** ONLINE/OFFLINE 여부만 판정 — status가 "ok"면 온라인. */
function isOnline(status: SystemStatus | null, key: ServiceKey): boolean {
  if (key === "web") return true; // 이 컴포넌트가 렌더링됐다는 것 자체가 web이 살아있다는 증거
  if (!status) return false;
  return status[key].status === "ok";
}

/** 서비스 상태를 한 박스에 모아 보여준다 — 박스 전체를 드래그해 하나의 단위로 옮긴다. */
export function ServerStatusOverlay({ open, onClose }: ServerStatusOverlayProps): JSX.Element | null {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [position, setPosition] = useState<Position>(() => loadPosition());
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const poll = () => {
      getSystemStatus()
        .then((res) => {
          if (!cancelled) setStatus(res);
        })
        .catch(() => {
          if (!cancelled) setStatus(null);
        });
    };
    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open]);

  const savePosition = useCallback((next: Position) => {
    try {
      window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 저장 실패해도 드래그 자체는 계속 동작해야 하므로 무시
    }
  }, []);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.pointerStartX;
    const dy = e.clientY - drag.pointerStartY;
    setPosition({ top: drag.boxStartTop + dy, left: drag.boxStartLeft + dx });
  }, []);

  const handlePointerUp = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    setPosition((prev) => {
      savePosition(prev);
      return prev;
    });
  }, [handlePointerMove, savePosition]);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      dragRef.current = {
        pointerStartX: e.clientX,
        pointerStartY: e.clientY,
        boxStartTop: position.top,
        boxStartLeft: position.left,
      };
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [position, handlePointerMove, handlePointerUp],
  );

  if (!open) return null;

  return (
    <div className="server-status-overlay">
      <div
        className="server-status-box"
        style={{ top: position.top, left: position.left }}
        onPointerDown={handlePointerDown}
      >
        <div className="server-status-box__header">
          <span>서버 상태</span>
          <button
            type="button"
            className="server-status-box__close"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="server-status-box__body">
          {SERVICE_KEYS.map((key) => {
            const online = isOnline(status, key);
            return (
              <span
                key={key}
                className={`header-status-chip header-status-chip--${online ? "online" : "offline"}`}
              >
                <span className="status-indicator-dot" />
                {SERVICE_LABELS[key]} {online ? "ONLINE" : "OFFLINE"}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
