import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExecutionStatus, RealtimeEvent } from "@smarthome/contracts";
import {
  ApiError,
  AuthExpiredError,
  createCommand,
  getAreaOverview,
  getDeviceHistory,
  getSession,
  listAreas,
  login as apiLogin,
  logout as apiLogout,
  saveAreaLayout,
  setDeviceMonitoring,
  listActiveAlarms,
  acknowledgeAlarm,
} from "./lib/api";
import type { AlarmRecord, AreaOverview, AreaSummary, AuthUser, DeviceHistory, DeviceListItem } from "./lib/types";
import { useRealtime } from "./lib/useRealtime";
import { LoginView } from "./components/LoginView";
import { FloorMap } from "./components/FloorMap";
import { DeviceDrawer } from "./components/DeviceDrawer";
import { EventFeed, type FeedEntry } from "./components/EventFeed";
import { SchedulerAdmin } from "./components/SchedulerAdmin";
import { SystemInfoAdmin } from "./components/SystemInfoAdmin";
import { FloorMapAdmin } from "./components/FloorMapAdmin";
import { ImageAdmin } from "./components/ImageAdmin";
import { DeviceAdmin } from "./components/DeviceAdmin";
import { CameraAdmin } from "./components/CameraAdmin";
import { RecommendationsAdmin } from "./components/RecommendationsAdmin";
import { Dashboard } from "./components/Dashboard";
import { GroupControl } from "./components/GroupControl";
import { FullMonitoring } from "./components/FullMonitoring";
import { AlarmBanner } from "./components/AlarmBanner";
import { ServerStatusOverlay } from "./components/ServerStatusOverlay";
import { useConfirm } from "./components/ConfirmDialog";
import { useSystemName } from "./lib/useSystemName";

const MAX_FEED_ENTRIES = 50;

interface PendingCommand {
  commandId: string;
  status: ExecutionStatus;
}

export function App(): JSX.Element {
  const confirm = useConfirm();
  const systemName = useSystemName();
  const [user, setUser] = useState<AuthUser | null>(() => getSession()?.user ?? null);
  const [serverStatusOpen, setServerStatusOpen] = useState(true);
  // 미확인(RAISED) 알람 — 현장 상태변화 등. 확인(ack) 전까지 배너/하이라이트로 유지된다.
  const [alarms, setAlarms] = useState<AlarmRecord[]>([]);
  const [areas, setAreas] = useState<AreaSummary[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [overview, setOverview] = useState<AreaOverview | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [history, setHistory] = useState<DeviceHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [pendingByDevice, setPendingByDevice] = useState<Record<string, PendingCommand>>({});
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const feedSeq = useRef(0);

  // 최상위 화면 전환(M16 Admin) — ADMIN 전용 스케줄러/시스템정보 화면과 기존 Floor Map 관제 화면을 오간다.
  const [view, setView] = useState<"dashboard" | "fullMonitoring" | "map" | "groupControl" | "schedulers" | "systemInfo" | "floorMaps" | "images" | "devices" | "cameras" | "recommendations">("dashboard");
  // 전체 모니터링에서 감시장비 선택 → 관제 화면에서 그 감시장비의 접점별 개별 제어를 펼치기 위한 포커스.
  const [focusEquipmentId, setFocusEquipmentId] = useState<string | null>(null);
  // 스케줄러 등 다른 화면에서 특정 그룹의 개별제어 패널을 펼쳐달라는 요청.
  const [focusGroupId, setFocusGroupId] = useState<string | null>(null);

  // 도면 편집 모드(ui-ux-design.md §4.1-mode) — ADMIN 전용. 실행 모드에서는 조회/제어만 가능하다.
  const [mode, setMode] = useState<"execute" | "edit">("execute");
  const [pendingPositions, setPendingPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [savingLayout, setSavingLayout] = useState(false);
  const isAdmin = user?.roles.includes("ADMIN") ?? false;
  const isHitlApprover = user?.roles.includes("HITL_APPROVER") ?? false;
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
    setAreas([]);
    setSelectedAreaId(null);
    setOverview(null);
    setSelectedDeviceId(null);
    setHistory(null);
    setFeed([]);
    setPendingByDevice({});
    setMode("execute");
    setPendingPositions({});
    setLayoutError(null);
    setAlarms([]);
    setView("dashboard");
  }, []);

  const handleLogin = useCallback(async (username: string, password: string) => {
    const loggedInUser = await apiLogin(username, password);
    setUser(loggedInUser);
  }, []);

  // 활성(RAISED) 알람 재조회 — 로그인 시 + alarm.raised/updated 실시간 이벤트마다.
  const refreshAlarms = useCallback(() => {
    listActiveAlarms()
      .then(setAlarms)
      .catch((err: unknown) => {
        if (err instanceof AuthExpiredError) handleLogout();
        // 그 외 오류는 조용히 무시(다음 이벤트/폴링에서 회복)
      });
  }, [handleLogout]);

  // 알람 확인(담당자/관리자) — 확인한 알람만 즉시 제거하고 서버 상태로 재동기화.
  const handleAckAlarm = useCallback(
    (id: string) => {
      setAlarms((prev) => prev.filter((alarm) => alarm.id !== id));
      acknowledgeAlarm(id)
        .then(() => refreshAlarms())
        .catch((err: unknown) => {
          if (err instanceof AuthExpiredError) handleLogout();
          else refreshAlarms(); // 실패 시 원복
        });
    },
    [refreshAlarms, handleLogout],
  );

  // 로그인 시 활성 알람 초기 로드(현장변화 알람이 이미 떠 있을 수 있음).
  useEffect(() => {
    if (user) refreshAlarms();
  }, [user, refreshAlarms]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    listAreas()
      .then((result) => {
        if (cancelled) return;
        setAreas(result);
        setLoadError(null);
        setSelectedAreaId((current) => current ?? result[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof AuthExpiredError) {
          handleLogout();
          return;
        }
        setLoadError(err instanceof Error ? err.message : "지역 목록을 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [user, handleLogout]);

  useEffect(() => {
    if (!selectedAreaId) return;
    let cancelled = false;
    getAreaOverview(selectedAreaId)
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
        setLoadError(err instanceof Error ? err.message : "지역 정보를 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAreaId, handleLogout]);

  const handleOpenFloorControl = useCallback((areaId: string) => {
    // 전등(제어 가능) 층 선택 → 관제(map) 화면으로 이동해 그 지역의 개별 제어(감시장비 드릴다운)를 연다.
    // 전열은 안전상 제어 대상이 아니므로 이 경로로 오지 않는다.
    if (dirtyCount > 0) setPendingPositions({});
    setLayoutError(null);
    setMode("execute");
    setSelectedAreaId(areaId);
    setSelectedDeviceId(null);
    setFocusEquipmentId(null);
    setView("map");
  }, [dirtyCount]);

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

  /** 스케줄러 등에서 DEVICE 대상을 클릭 → 그 기기가 속한 지역으로 전환하고 Floor Map에서 선택한다.
   * 기기의 areaTopicPrefix는 곧 그 지역(area) 자신의 topicPrefix이므로 정확히 일치하는 지역을 찾는다. */
  const handleNavigateToDevice = useCallback(
    (device: DeviceListItem) => {
      const area = areas.find((a) => a.topicPrefix === device.areaTopicPrefix);
      if (dirtyCount > 0) setPendingPositions({});
      setLayoutError(null);
      setMode("execute");
      if (area) setSelectedAreaId(area.id);
      setView("map");
      handleSelectDevice(device);
    },
    [areas, dirtyCount, handleSelectDevice],
  );

  /** 스케줄러 등에서 GROUP 대상을 클릭 → 그룹별 제어 화면으로 이동해 해당 그룹을 펼친다. */
  const handleNavigateToGroup = useCallback((groupId: string) => {
    setView("groupControl");
    setFocusGroupId(groupId);
  }, []);

  const handleSendCommand = useCallback(
    (command: "turn_on" | "turn_off" | "query_state") => {
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
    if (!selectedAreaId || dirtyCount === 0) return;
    setSavingLayout(true);
    setLayoutError(null);
    const positions = Object.entries(pendingPositions).map(([deviceId, p]) => ({
      deviceId,
      posX: p.x,
      posY: p.y,
    }));
    saveAreaLayout(selectedAreaId, positions)
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
  }, [selectedAreaId, dirtyCount, pendingPositions, handleLogout]);

  const handleCancelLayout = useCallback(() => {
    setPendingPositions({});
    setLayoutError(null);
  }, []);

  const handleToggleMode = useCallback(() => {
    if (mode === "edit" && dirtyCount > 0) {
      confirm(`저장하지 않은 위치 변경 ${dirtyCount}건이 있습니다. 실행 모드로 전환하면 버려집니다. 계속할까요?`).then(
        (discard) => {
          if (!discard) return;
          setPendingPositions({});
          setLayoutError(null);
          setMode((prev) => (prev === "execute" ? "edit" : "execute"));
        },
      );
      return;
    }
    setMode((prev) => (prev === "execute" ? "edit" : "execute"));
  }, [mode, dirtyCount, confirm]);

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

      // 현장 상태변화 등으로 알람 발생/변경 → 활성 알람 재조회(배너·하이라이트 갱신).
      if (event.type === "alarm.raised" || event.type === "alarm.updated") {
        refreshAlarms();
      }
    },
    [selectedDevice, refreshAlarms],
  );

  useRealtime(Boolean(user), handleRealtimeEvent, handleLogout);

  const alarmedDeviceIds = useMemo(
    () => new Set(alarms.map((a) => a.deviceId).filter((id): id is string => id !== null)),
    [alarms],
  );
  const resolveDeviceName = useCallback(
    (deviceId: string | null): string | null =>
      overview?.devices.find((d) => d.id === deviceId)?.name ?? null,
    [overview],
  );

  if (!user) {
    return <LoginView onLogin={handleLogin} />;
  }

  return (
    <div className="app-shell">
      <header className="app-shell__top">
        <h1>{systemName}</h1>
        <label>
          지역{" "}
          <select
            value={selectedAreaId ?? ""}
            onChange={(e) => {
              const nextAreaId = e.target.value;
              if (dirtyCount > 0) {
                confirm(`저장하지 않은 위치 변경 ${dirtyCount}건이 있습니다. 지역을 바꾸면 버려집니다. 계속할까요?`).then(
                  (discard) => {
                    if (!discard) return;
                    setPendingPositions({});
                    setLayoutError(null);
                    setSelectedAreaId(nextAreaId);
                    setSelectedDeviceId(null);
                  },
                );
                return;
              }
              setSelectedAreaId(nextAreaId);
              setSelectedDeviceId(null);
            }}
          >
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.siteName} · {area.buildingName} · {area.floorName} · {area.name}
              </option>
            ))}
          </select>
        </label>
        {isAdmin && (
          <label className={`edit-mode-toggle${view !== "map" ? " edit-mode-toggle--disabled" : ""}`}>
            <input
              type="checkbox"
              checked={mode === "edit"}
              disabled={view !== "map"}
              onChange={handleToggleMode}
            />
            편집
          </label>
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
              지역 관리
            </button>
            <button type="button" className={view === "images" ? "active" : ""} onClick={() => setView("images")}>
              이미지 관리
            </button>
            <button type="button" className={view === "devices" ? "active" : ""} onClick={() => setView("devices")}>
              기기 관리
            </button>
            <button type="button" className={view === "cameras" ? "active" : ""} onClick={() => setView("cameras")}>
              카메라 관리
            </button>
            <button
              type="button"
              className={view === "recommendations" ? "active" : ""}
              onClick={() => setView("recommendations")}
            >
              AI 추천 승인
            </button>
          </div>
        )}
        {!isAdmin && isHitlApprover && (
          <div className="mode-toggle">
            <button
              type="button"
              className={view === "recommendations" ? "active" : ""}
              onClick={() => setView("recommendations")}
            >
              AI 추천 승인
            </button>
          </div>
        )}
        {isAdmin && (
          <label className="server-status-toggle">
            <input
              type="checkbox"
              checked={serverStatusOpen}
              onChange={(e) => setServerStatusOpen(e.target.checked)}
            />
            서버 상태
          </label>
        )}
        <span className="app-shell__user">
          {user.username} ({user.roles.join(", ")})
        </span>
        <button type="button" onClick={handleLogout}>
          로그아웃
        </button>
      </header>

      <AlarmBanner alarms={alarms} onAck={handleAckAlarm} resolveDeviceName={resolveDeviceName} />
      {isAdmin && (
        <ServerStatusOverlay open={serverStatusOpen} onClose={() => setServerStatusOpen(false)} />
      )}

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
          <FullMonitoring onOpenLightingControl={handleOpenFloorControl} />
        </div>
      ) : view === "groupControl" ? (
        <div className="app-shell__body app-shell__body--single">
          <GroupControl
            onAuthExpired={handleLogout}
            initialOpenGroupId={focusGroupId}
            onInitialFocusHandled={() => setFocusGroupId(null)}
          />
        </div>
      ) : view === "schedulers" ? (
        <div className="app-shell__body app-shell__body--single">
          <SchedulerAdmin onNavigateToDevice={handleNavigateToDevice} onNavigateToGroup={handleNavigateToGroup} />
        </div>
      ) : view === "systemInfo" ? (
        <div className="app-shell__body app-shell__body--single">
          <SystemInfoAdmin />
        </div>
      ) : view === "floorMaps" ? (
        <div className="app-shell__body app-shell__body--single">
          <FloorMapAdmin />
        </div>
      ) : view === "images" ? (
        <div className="app-shell__body app-shell__body--single">
          <ImageAdmin />
        </div>
      ) : view === "devices" ? (
        <div className="app-shell__body app-shell__body--single">
          <DeviceAdmin />
        </div>
      ) : view === "cameras" ? (
        <div className="app-shell__body app-shell__body--single">
          <CameraAdmin />
        </div>
      ) : view === "recommendations" ? (
        <div className="app-shell__body app-shell__body--single">
          <RecommendationsAdmin />
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
                focusEquipmentId={focusEquipmentId}
                onFocusHandled={() => setFocusEquipmentId(null)}
                alarmedDeviceIds={alarmedDeviceIds}
              />
            ) : (
              <p>지역을 불러오는 중…</p>
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
