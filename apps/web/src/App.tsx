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
  saveFloorLayout,
  setDeviceMonitoring,
} from "./lib/api";
import type { AuthUser, DeviceHistory, DeviceListItem, FloorOverview, FloorSummary } from "./lib/types";
import { useRealtime } from "./lib/useRealtime";
import { LoginView } from "./components/LoginView";
import { FloorMap } from "./components/FloorMap";
import { DeviceDrawer } from "./components/DeviceDrawer";
import { EventFeed, type FeedEntry } from "./components/EventFeed";
import { SchedulerAdmin } from "./components/SchedulerAdmin";
import { SystemInfoAdmin } from "./components/SystemInfoAdmin";
import { FloorMapAdmin } from "./components/FloorMapAdmin";
import { AreaAdmin } from "./components/AreaAdmin";
import { DeviceAdmin } from "./components/DeviceAdmin";
import { Dashboard } from "./components/Dashboard";
import { GroupControl } from "./components/GroupControl";
import { FullMonitoring } from "./components/FullMonitoring";

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

  // 최상위 화면 전환(M16 Admin) — ADMIN 전용 스케줄러/시스템정보 화면과 기존 Floor Map 관제 화면을 오간다.
  const [view, setView] = useState<"dashboard" | "fullMonitoring" | "map" | "groupControl" | "schedulers" | "systemInfo" | "floorMaps" | "areas" | "devices">("dashboard");

  // 도면 편집 모드(ui-ux-design.md §4.1-mode) — ADMIN 전용. 실행 모드에서는 조회/제어만 가능하다.
  const [mode, setMode] = useState<"execute" | "edit">("execute");
  const [pendingPositions, setPendingPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [savingLayout, setSavingLayout] = useState(false);
  const isAdmin = user?.roles.includes("ADMIN") ?? false;
  const dirtyCount = Object.keys(pendingPositions).length;

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
    setMode("execute");
    setPendingPositions({});
    setLayoutError(null);
    setView("dashboard");
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

  const handleSetDeviceMonitoring = useCallback(
    (flags: { monitoringVisible?: boolean; enabled?: boolean }) => {
      if (!selectedDevice) return;
      setDeviceMonitoring(selectedDevice.id, flags)
        .then((updated) => {
          setOverview((prev) => {
            if (!prev) return prev;
            const shouldShow =
              updated.monitoringVisible &&
              updated.enabled &&
              updated.lifecycleStatus !== "DECOMMISSIONED";
            if (!shouldShow) {
              return { ...prev, devices: prev.devices.filter((device) => device.id !== updated.id) };
            }
            const devices = prev.devices.map((device) =>
              device.id === updated.id ? { ...device, ...updated } : device,
            );
            return { ...prev, devices };
          });
          if (!updated.monitoringVisible || !updated.enabled) {
            setSelectedDeviceId(null);
          }
        })
        .catch((err: unknown) => {
          if (err instanceof AuthExpiredError) {
            handleLogout();
            return;
          }
          setHistoryError(err instanceof ApiError ? err.detail : "모니터링 설정 변경에 실패했습니다.");
        });
    },
    [selectedDevice, handleLogout],
  );

  const handleDeviceDragEnd = useCallback((deviceId: string, x: number, y: number) => {
    setPendingPositions((prev) => ({ ...prev, [deviceId]: { x, y } }));
  }, []);

  const handleSaveLayout = useCallback(() => {
    if (!selectedFloorId || dirtyCount === 0) return;
    setSavingLayout(true);
    setLayoutError(null);
    const positions = Object.entries(pendingPositions).map(([deviceId, p]) => ({
      deviceId,
      posX: p.x,
      posY: p.y,
    }));
    saveFloorLayout(selectedFloorId, positions)
      .then(() => {
        setOverview((prev) => {
          if (!prev) return prev;
          const devices = prev.devices.map((d) =>
            pendingPositions[d.id]
              ? { ...d, posX: String(pendingPositions[d.id]!.x), posY: String(pendingPositions[d.id]!.y) }
              : d,
          );
          return { ...prev, devices };
        });
        setPendingPositions({});
      })
      .catch((err: unknown) => {
        if (err instanceof AuthExpiredError) {
          handleLogout();
          return;
        }
        setLayoutError(err instanceof ApiError ? err.detail : "배치 저장에 실패했습니다.");
      })
      .finally(() => setSavingLayout(false));
  }, [selectedFloorId, dirtyCount, pendingPositions, handleLogout]);

  const handleCancelLayout = useCallback(() => {
    setPendingPositions({});
    setLayoutError(null);
  }, []);

  const handleToggleMode = useCallback(() => {
    if (mode === "edit" && dirtyCount > 0) {
      const discard = window.confirm(
        `저장하지 않은 위치 변경 ${dirtyCount}건이 있습니다. 실행 모드로 전환하면 버려집니다. 계속할까요?`,
      );
      if (!discard) return;
      setPendingPositions({});
      setLayoutError(null);
    }
    setMode((prev) => (prev === "execute" ? "edit" : "execute"));
  }, [mode, dirtyCount]);

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
              if (dirtyCount > 0) {
                const discard = window.confirm(
                  `저장하지 않은 위치 변경 ${dirtyCount}건이 있습니다. 층을 바꾸면 버려집니다. 계속할까요?`,
                );
                if (!discard) return;
                setPendingPositions({});
                setLayoutError(null);
              }
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
        {isAdmin && view === "map" && (
          <div className="mode-toggle">
            <button type="button" className={mode === "execute" ? "active" : ""} onClick={() => mode !== "execute" && handleToggleMode()}>
              실행
            </button>
            <button type="button" className={mode === "edit" ? "active" : ""} onClick={() => mode !== "edit" && handleToggleMode()}>
              편집
            </button>
          </div>
        )}
        <div className="mode-toggle">
          <button type="button" className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>
            대시보드
          </button>
          <button type="button" className={view === "map" ? "active" : ""} onClick={() => setView("map")}>
            관제
          </button>
          <button type="button" className={view === "fullMonitoring" ? "active" : ""} onClick={() => setView("fullMonitoring")}>
            전체 모니터링
          </button>
          <button type="button" className={view === "groupControl" ? "active" : ""} onClick={() => setView("groupControl")}>
            그룹 제어
          </button>
        </div>
        {isAdmin && (
          <div className="mode-toggle">
            <button type="button" className={view === "schedulers" ? "active" : ""} onClick={() => setView("schedulers")}>
              스케줄러
            </button>
            <button type="button" className={view === "systemInfo" ? "active" : ""} onClick={() => setView("systemInfo")}>
              시스템 정보
            </button>
            <button type="button" className={view === "floorMaps" ? "active" : ""} onClick={() => setView("floorMaps")}>
              도면 관리
            </button>
            <button type="button" className={view === "areas" ? "active" : ""} onClick={() => setView("areas")}>
              지역 관리
            </button>
            <button type="button" className={view === "devices" ? "active" : ""} onClick={() => setView("devices")}>
              기기 관리
            </button>
          </div>
        )}
        <span className="app-shell__user">
          {user.username} ({user.roles.join(", ")})
        </span>
        <button type="button" onClick={handleLogout}>
          로그아웃
        </button>
      </header>

      {view === "map" && mode === "edit" && (
        <div className="layout-editbar">
          <span>편집 모드 — 마커를 드래그해 위치를 옮기세요.</span>
          {dirtyCount > 0 && <strong>변경 {dirtyCount}건</strong>}
          {layoutError && <span className="error-text">{layoutError}</span>}
          <button type="button" onClick={handleCancelLayout} disabled={dirtyCount === 0 || savingLayout}>
            취소
          </button>
          <button type="button" className="primary" onClick={handleSaveLayout} disabled={dirtyCount === 0 || savingLayout}>
            {savingLayout ? "저장 중…" : "저장"}
          </button>
        </div>
      )}

      {loadError && <p className="error-text">{loadError}</p>}

      {view === "dashboard" ? (
        <div className="app-shell__body app-shell__body--single">
          <Dashboard />
        </div>
      ) : view === "fullMonitoring" ? (
        <div className="app-shell__body app-shell__body--single">
          <FullMonitoring />
        </div>
      ) : view === "groupControl" ? (
        <div className="app-shell__body app-shell__body--single">
          <GroupControl onAuthExpired={handleLogout} />
        </div>
      ) : view === "schedulers" ? (
        <div className="app-shell__body app-shell__body--single">
          <SchedulerAdmin />
        </div>
      ) : view === "systemInfo" ? (
        <div className="app-shell__body app-shell__body--single">
          <SystemInfoAdmin />
        </div>
      ) : view === "floorMaps" ? (
        <div className="app-shell__body app-shell__body--single">
          <FloorMapAdmin />
        </div>
      ) : view === "areas" ? (
        <div className="app-shell__body app-shell__body--single">
          <AreaAdmin />
        </div>
      ) : view === "devices" ? (
        <div className="app-shell__body app-shell__body--single">
          <DeviceAdmin />
        </div>
      ) : (
        <div className="app-shell__body">
          <main className="app-shell__map">
            {overview ? (
              <FloorMap
                overview={overview}
                selectedDeviceId={selectedDevice?.id ?? null}
                onSelectDevice={handleSelectDevice}
                editMode={mode === "edit"}
                pendingPositions={pendingPositions}
                onDeviceDragEnd={handleDeviceDragEnd}
              />
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
                onSetMonitoring={handleSetDeviceMonitoring}
                editMode={mode === "edit"}
                isAdmin={isAdmin}
              />
            )}
            <EventFeed entries={feed} />
          </div>
        </div>
      )}
    </div>
  );
}
