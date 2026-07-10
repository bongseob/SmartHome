import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExecutionStatus, RealtimeEvent } from "@smarthome/contracts";
import {
  ApiError,
  AuthExpiredError,
  createCommand,
  getDeviceHistory,
  getFloorOverview,
  getSession,
  listFloors,
  login as apiLogin,
  logout as apiLogout,
} from "./lib/api";
import type { AuthUser, DeviceHistory, DeviceListItem, FloorOverview, FloorSummary } from "./lib/types";
import { useRealtime } from "./lib/useRealtime";
import { LoginView } from "./components/LoginView";
import { FloorMap } from "./components/FloorMap";
import { DeviceDrawer } from "./components/DeviceDrawer";
import { EventFeed, type FeedEntry } from "./components/EventFeed";

const MAX_FEED_ENTRIES = 50;

interface PendingCommand {
  commandId: string;
  status: ExecutionStatus;
}

export function App(): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(() => getSession()?.user ?? null);
  const [floors, setFloors] = useState<FloorSummary[]>([]);
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [overview, setOverview] = useState<FloorOverview | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [history, setHistory] = useState<DeviceHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [pendingByDevice, setPendingByDevice] = useState<Record<string, PendingCommand>>({});
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const feedSeq = useRef(0);

  // overview.devices는 실시간으로 갱신되므로, 선택된 기기는 id로만 들고 매 렌더에서 최신 값을 파생한다
  // (별도 스냅샷으로 들고 있으면 realtime 업데이트가 반영되지 않는 상태 불일치가 생긴다).
  const selectedDevice = useMemo(
    () => overview?.devices.find((d) => d.id === selectedDeviceId) ?? null,
    [overview, selectedDeviceId],
  );

  const handleLogout = useCallback(() => {
    void apiLogout();
    setUser(null);
    setFloors([]);
    setSelectedFloorId(null);
    setOverview(null);
    setSelectedDeviceId(null);
    setHistory(null);
    setFeed([]);
    setPendingByDevice({});
  }, []);

  const handleLogin = useCallback(async (username: string, password: string) => {
    const loggedInUser = await apiLogin(username, password);
    setUser(loggedInUser);
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    listFloors()
      .then((result) => {
        if (cancelled) return;
        setFloors(result);
        setLoadError(null);
        setSelectedFloorId((current) => current ?? result[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof AuthExpiredError) {
          handleLogout();
          return;
        }
        setLoadError(err instanceof Error ? err.message : "층 목록을 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [user, handleLogout]);

  useEffect(() => {
    if (!selectedFloorId) return;
    let cancelled = false;
    getFloorOverview(selectedFloorId)
      .then((result) => {
        if (cancelled) return;
        setOverview(result);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof AuthExpiredError) {
          handleLogout();
          return;
        }
        setLoadError(err instanceof Error ? err.message : "층 정보를 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedFloorId, handleLogout]);

  const handleSelectDevice = useCallback((device: DeviceListItem) => {
    setSelectedDeviceId(device.id);
    setHistory(null);
    setHistoryError(null);
    getDeviceHistory(device.id)
      .then(setHistory)
      .catch((err: unknown) => {
        if (err instanceof AuthExpiredError) {
          handleLogout();
          return;
        }
        setHistoryError(err instanceof Error ? err.message : "이력을 불러오지 못했습니다.");
      });
  }, [handleLogout]);

  const handleSendCommand = useCallback(
    (command: "turn_on" | "turn_off") => {
      if (!selectedDevice) return;
      createCommand(command, selectedDevice.id)
        .then((result) => {
          setPendingByDevice((prev) => ({
            ...prev,
            [selectedDevice.id]: { commandId: result.commandId, status: result.status },
          }));
        })
        .catch((err: unknown) => {
          if (err instanceof AuthExpiredError) {
            handleLogout();
            return;
          }
          const message = err instanceof ApiError ? err.detail : "명령 전송에 실패했습니다.";
          setHistoryError(message);
        });
    },
    [selectedDevice, handleLogout],
  );

  const handleRealtimeEvent = useCallback(
    (event: RealtimeEvent) => {
      feedSeq.current += 1;
      setFeed((prev) => [{ key: `${event.type}-${feedSeq.current}`, event }, ...prev].slice(0, MAX_FEED_ENTRIES));

      if (event.type === "device.state") {
        setOverview((prev) => {
          if (!prev) return prev;
          const index = prev.devices.findIndex((d) => d.id === event.deviceId);
          if (index === -1) return prev;
          const devices = [...prev.devices];
          const existing = devices[index];
          if (!existing) return prev;
          devices[index] = { ...existing, currentStatus: event.status };
          return { ...prev, devices };
        });
      }

      if (event.type === "command.status") {
        setPendingByDevice((prev) => {
          const entry = Object.entries(prev).find(([, value]) => value.commandId === event.commandId);
          if (!entry) return prev;
          return { ...prev, [entry[0]]: { commandId: event.commandId, status: event.status } };
        });
        if (selectedDevice && event.targetId === selectedDevice.id) {
          getDeviceHistory(selectedDevice.id)
            .then(setHistory)
            .catch(() => undefined);
        }
      }
    },
    [selectedDevice],
  );

  useRealtime(Boolean(user), handleRealtimeEvent, handleLogout);

  if (!user) {
    return <LoginView onLogin={handleLogin} />;
  }

  return (
    <div className="app-shell">
      <header className="app-shell__top">
        <h1>SmartHome 관제</h1>
        <label>
          층{" "}
          <select
            value={selectedFloorId ?? ""}
            onChange={(e) => {
              setSelectedFloorId(e.target.value);
              setSelectedDeviceId(null);
            }}
          >
            {floors.map((floor) => (
              <option key={floor.id} value={floor.id}>
                {floor.siteName} · {floor.buildingName} · {floor.name}
              </option>
            ))}
          </select>
        </label>
        <span className="app-shell__user">
          {user.username} ({user.roles.join(", ")})
        </span>
        <button type="button" onClick={handleLogout}>
          로그아웃
        </button>
      </header>

      {loadError && <p className="error-text">{loadError}</p>}

      <div className="app-shell__body">
        <main className="app-shell__map">
          {overview ? (
            <FloorMap overview={overview} selectedDeviceId={selectedDevice?.id ?? null} onSelectDevice={handleSelectDevice} />
          ) : (
            <p>층을 불러오는 중…</p>
          )}
        </main>
        <div className="app-shell__side">
          {selectedDevice && (
            <DeviceDrawer
              device={selectedDevice}
              history={history}
              historyError={historyError}
              pendingCommand={pendingByDevice[selectedDevice.id] ?? null}
              onClose={() => setSelectedDeviceId(null)}
              onSendCommand={handleSendCommand}
            />
          )}
          <EventFeed entries={feed} />
        </div>
      </div>
    </div>
  );
}
