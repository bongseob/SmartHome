import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  ValidationModule,
  type ColDef,
  type ICellRendererParams,
} from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import type { ExecutionStatus } from "@smarthome/contracts";
import {
  ApiError,
  AuthExpiredError,
  createCommand,
  createGroupCommand,
  getCommand,
  listGroupControlDevices,
  listGroupControlSummaries,
} from "../lib/api";
import type { DeviceListItem, GroupCommandResponse, GroupControlSummary } from "../lib/types";
import { useRealtime } from "../lib/useRealtime";

type ControlCommand = "turn_on" | "turn_off";

ModuleRegistry.registerModules([AllCommunityModule, ValidationModule]);

interface CommandTracker {
  commandId: string;
  deviceId: string;
  deviceName: string;
  status: ExecutionStatus;
}

interface ProgressState {
  label: string;
  total: number;
  intervalMs?: number;
  trackers: CommandTracker[];
  errors: string[];
  issuing: boolean;
}

const TERMINAL_STATUSES = new Set<ExecutionStatus>(["SUCCEEDED", "FAILED", "TIMED_OUT"]);

function commandLabel(command: ControlCommand): string {
  return command === "turn_on" ? "ON" : "OFF";
}

function statusText(status: ExecutionStatus): string {
  switch (status) {
    case "CREATED":
      return "생성";
    case "PENDING":
      return "대기";
    case "IN_PROGRESS":
      return "진행";
    case "SUCCEEDED":
      return "완료";
    case "FAILED":
      return "실패";
    case "TIMED_OUT":
      return "시간초과";
    default:
      return status;
  }
}

function groupState(group: GroupControlSummary): "all-on" | "all-off" | "mixed" | "empty" {
  if (group.totalCount === 0) return "empty";
  if (group.onCount === group.totalCount) return "all-on";
  if (group.offCount === group.totalCount) return "all-off";
  return "mixed";
}

function describeError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.detail;
  if (err instanceof Error) return err.message;
  return fallback;
}

export function GroupControl({ onAuthExpired }: { onAuthExpired: () => void }): JSX.Element {
  const [groups, setGroups] = useState<GroupControlSummary[]>([]);
  const [membersByGroup, setMembersByGroup] = useState<Record<string, DeviceListItem[]>>({});
  const [selectedByGroup, setSelectedByGroup] = useState<Record<string, Set<string>>>({});
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [progressByGroup, setProgressByGroup] = useState<Record<string, ProgressState>>({});
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const activeProgress = useMemo(
    () => Object.entries(progressByGroup).filter(([, progress]) => progress.trackers.length > 0 || progress.issuing),
    [progressByGroup],
  );

  const openGroup = useMemo(
    () => groups.find((group) => group.id === openGroupId) ?? null,
    [groups, openGroupId],
  );
  const openMembers = openGroup ? membersByGroup[openGroup.id] ?? [] : [];
  const openSelected = openGroup ? selectedByGroup[openGroup.id] ?? new Set<string>() : new Set<string>();
  const openSelectedDevices = openMembers.filter((device) => openSelected.has(device.id));

  const refreshGroups = useCallback(() => {
    setError(null);
    listGroupControlSummaries()
      .then(setGroups)
      .catch((err: unknown) => {
        if (err instanceof AuthExpiredError) {
          onAuthExpired();
          return;
        }
        setError(describeError(err, "그룹 목록을 불러오지 못했습니다."));
      });
  }, [onAuthExpired]);

  useEffect(() => {
    refreshGroups();
  }, [refreshGroups]);

  const handleRealtimeEvent = useCallback(
    (event: any) => {
      if (event.type === "device.state") {
        // 1. 그룹 목록 갱신
        refreshGroups();

        // 2. 현재 개별제어 모달 기기 목록 상태 갱신
        setMembersByGroup((prev) => {
          const next = { ...prev };
          let updated = false;
          for (const [groupId, devices] of Object.entries(next)) {
            const idx = devices.findIndex((d) => d.id === event.deviceId);
            if (idx !== -1) {
              const updatedDevices = [...devices];
              updatedDevices[idx] = { ...updatedDevices[idx], currentStatus: event.status };
              next[groupId] = updatedDevices;
              updated = true;
            }
          }
          return updated ? next : prev;
        });
      }
    },
    [refreshGroups]
  );

  useRealtime(true, handleRealtimeEvent, onAuthExpired);

  const loadMembers = useCallback(
    (groupId: string) => {
      setOpenGroupId((current) => (current === groupId ? null : groupId));
      if (membersByGroup[groupId]) return;
      listGroupControlDevices(groupId)
        .then((devices) => {
          setMembersByGroup((prev) => ({ ...prev, [groupId]: devices }));
          setSelectedByGroup((prev) => ({ ...prev, [groupId]: new Set(devices.map((device) => device.id)) }));
        })
        .catch((err: unknown) => {
          if (err instanceof AuthExpiredError) {
            onAuthExpired();
            return;
          }
          setError(describeError(err, "그룹 내 기기를 불러오지 못했습니다."));
        });
    },
    [membersByGroup, onAuthExpired],
  );

  const updateProgressFromResponse = useCallback(
    (group: GroupControlSummary, command: ControlCommand, response: GroupCommandResponse) => {
      const members = membersByGroup[group.id] ?? [];
      const memberName = new Map(members.map((device) => [device.id, device.name]));
      const trackers = response.results
        .filter((item) => item.commandId)
        .map((item) => ({
          commandId: item.commandId!,
          deviceId: item.deviceId,
          deviceName: memberName.get(item.deviceId) ?? item.deviceId,
          status: item.status ?? "PENDING",
        }));
      const errors = response.results
        .filter((item) => item.error)
        .map((item) => `${memberName.get(item.deviceId) ?? item.deviceId}: ${item.error}`);
      setProgressByGroup((prev) => ({
        ...prev,
        [group.id]: {
          label: `${group.name} 일괄 ${commandLabel(command)}`,
          total: response.count,
          intervalMs: response.intervalMs,
          trackers,
          errors,
          issuing: false,
        },
      }));
      refreshGroups();
    },
    [membersByGroup, refreshGroups],
  );

  const runGroupCommand = useCallback(
    (group: GroupControlSummary, command: ControlCommand) => {
      if (group.totalCount === 0) return;
      setProgressByGroup((prev) => ({
        ...prev,
        [group.id]: {
          label: `${group.name} 일괄 ${commandLabel(command)}`,
          total: group.totalCount,
          trackers: [],
          errors: [],
          issuing: true,
        },
      }));
      createGroupCommand(command, group.id)
        .then((response) => updateProgressFromResponse(group, command, response))
        .catch((err: unknown) => {
          if (err instanceof AuthExpiredError) {
            onAuthExpired();
            return;
          }
          setProgressByGroup((prev) => ({
            ...prev,
            [group.id]: {
              label: `${group.name} 일괄 ${commandLabel(command)}`,
              total: group.totalCount,
              trackers: [],
              errors: [describeError(err, "일괄 제어 명령 전송에 실패했습니다.")],
              issuing: false,
            },
          }));
        });
    },
    [onAuthExpired, updateProgressFromResponse],
  );

  const runDeviceCommands = useCallback(
    (group: GroupControlSummary, devices: DeviceListItem[], command: ControlCommand) => {
      const groupId = group.id;
      setProgressByGroup((prev) => ({
        ...prev,
        [groupId]: {
          label: `${group.name} 선택 ${commandLabel(command)}`,
          total: devices.length,
          trackers: [],
          errors: [],
          issuing: true,
        },
      }));

      Promise.allSettled(devices.map((device) => createCommand(command, device.id).then((result) => ({ device, result }))))
        .then((results) => {
          const trackers: CommandTracker[] = [];
          const errors: string[] = [];
          for (const result of results) {
            if (result.status === "fulfilled") {
              trackers.push({
                commandId: result.value.result.commandId,
                deviceId: result.value.device.id,
                deviceName: result.value.device.name,
                status: result.value.result.status,
              });
            } else {
              errors.push(describeError(result.reason, "개별 제어 명령 전송에 실패했습니다."));
            }
          }
          setProgressByGroup((prev) => ({
            ...prev,
            [groupId]: {
              label: `${group.name} 선택 ${commandLabel(command)}`,
              total: devices.length,
              trackers,
              errors,
              issuing: false,
            },
          }));
          refreshGroups();
        })
        .catch(() => undefined);
    },
    [refreshGroups],
  );

  useEffect(() => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    const hasOpenCommands = Object.values(progressByGroup).some((progress) =>
      progress.trackers.some((tracker) => !TERMINAL_STATUSES.has(tracker.status)),
    );
    if (!hasOpenCommands) return;

    pollRef.current = window.setInterval(() => {
      const trackers = Object.values(progressByGroup).flatMap((progress) =>
        progress.trackers.filter((tracker) => !TERMINAL_STATUSES.has(tracker.status)),
      );
      void Promise.allSettled(trackers.map((tracker) => getCommand(tracker.commandId))).then((results) => {
        const nextStatus = new Map<string, ExecutionStatus>();
        for (const result of results) {
          if (result.status === "fulfilled") {
            nextStatus.set(result.value.commandId, result.value.status);
          }
        }
        if (nextStatus.size === 0) return;
        setProgressByGroup((prev) => {
          const next: Record<string, ProgressState> = {};
          for (const [groupId, progress] of Object.entries(prev)) {
            next[groupId] = {
              ...progress,
              trackers: progress.trackers.map((tracker) => ({
                ...tracker,
                status: nextStatus.get(tracker.commandId) ?? tracker.status,
              })),
            };
          }
          return next;
        });
        refreshGroups();
      });
    }, 1000);

    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, [progressByGroup, refreshGroups]);

  const defaultColDef = useMemo<ColDef<GroupControlSummary>>(
    () => ({
      resizable: true,
      sortable: true,
      filter: true,
      suppressMovable: true,
    }),
    [],
  );

  const groupColumns = useMemo<ColDef<GroupControlSummary>[]>(
    () => [
      {
        headerName: "상태",
        width: 88,
        filter: false,
        sortable: false,
        cellRenderer: (params: ICellRendererParams<GroupControlSummary>) => {
          const group = params.data;
          if (!group) return null;
          return <i className={`group-state group-state--${groupState(group)}`} />;
        },
      },
      {
        headerName: "그룹명",
        field: "name",
        flex: 1,
        minWidth: 220,
        cellRenderer: (params: ICellRendererParams<GroupControlSummary>) => {
          const group = params.data;
          if (!group) return null;
          return (
            <span className="group-control__name-cell">
              <strong>{group.name}</strong>
              {group.unknownCount > 0 && <span className="group-control__muted"> 미확인 {group.unknownCount}</span>}
            </span>
          );
        },
      },
      { headerName: "전체", field: "totalCount", width: 92, type: "numericColumn" },
      { headerName: "ON", field: "onCount", width: 86, type: "numericColumn" },
      { headerName: "OFF", field: "offCount", width: 86, type: "numericColumn" },
      {
        headerName: "개별제어",
        width: 128,
        filter: false,
        sortable: false,
        cellRenderer: (params: ICellRendererParams<GroupControlSummary>) => {
          const group = params.data;
          if (!group) return null;
          return (
            <button type="button" onClick={() => loadMembers(group.id)}>
              {openGroupId === group.id ? "닫기" : "개별제어"}
            </button>
          );
        },
      },
      {
        headerName: "일괄제어",
        width: 164,
        filter: false,
        sortable: false,
        cellRenderer: (params: ICellRendererParams<GroupControlSummary>) => {
          const group = params.data;
          if (!group) return null;
          return (
            <span className="group-control__actions">
              <button type="button" onClick={() => runGroupCommand(group, "turn_on")} disabled={group.totalCount === 0}>
                ON
              </button>
              <button type="button" onClick={() => runGroupCommand(group, "turn_off")} disabled={group.totalCount === 0}>
                OFF
              </button>
            </span>
          );
        },
      },
    ],
    [loadMembers, openGroupId, runGroupCommand],
  );

  return (
    <section className="group-control">
      <header className="group-control__header">
        <div>
          <h2>그룹별 제어</h2>
          <p>그룹 단위로 일괄 제어하고, 필요하면 그룹 내 센서를 선택해 개별 제어합니다.</p>
        </div>
      </header>

      {error && <p className="error-text">{error}</p>}

      <div className="group-control__legend" aria-label="상태 범례">
        <span><i className="group-state group-state--all-on" /> All ON</span>
        <span><i className="group-state group-state--all-off" /> All OFF</span>
        <span><i className="group-state group-state--mixed" /> 혼합</span>
      </div>

      <div className="group-control__grid ag-theme-quartz">
        <AgGridReact<GroupControlSummary>
          rowData={groups}
          columnDefs={groupColumns}
          defaultColDef={defaultColDef}
          getRowId={(params) => params.data.id}
          rowHeight={52}
          domLayout="autoHeight"
          suppressCellFocus
          theme="legacy"
        />
      </div>

      {openGroup && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: "640px" }}>
            <h3>[{openGroup.name}] 그룹 내 기기 개별 제어</h3>
            
            <div className="group-control__member-toolbar">
              <strong>기기 {openMembers.length}개</strong>
              <span>선택 {openSelectedDevices.length}개</span>
              <button
                type="button"
                onClick={() => setSelectedByGroup((prev) => ({ ...prev, [openGroup.id]: new Set(openMembers.map((device) => device.id)) }))}
              >
                전체선택
              </button>
              <button
                type="button"
                onClick={() => setSelectedByGroup((prev) => ({ ...prev, [openGroup.id]: new Set() }))}
              >
                선택해제
              </button>
              <button type="button" onClick={() => runDeviceCommands(openGroup, openSelectedDevices, "turn_on")} disabled={openSelectedDevices.length === 0}>
                선택 ON
              </button>
              <button type="button" onClick={() => runDeviceCommands(openGroup, openSelectedDevices, "turn_off")} disabled={openSelectedDevices.length === 0}>
                선택 OFF
              </button>
            </div>

            <div className="group-control__member-list">
              {openMembers.map((device) => (
                <label key={device.id} className="group-control__member-row">
                  <input
                    type="checkbox"
                    checked={openSelected.has(device.id)}
                    onChange={(event) =>
                      setSelectedByGroup((prev) => {
                        const next = new Set(prev[openGroup.id] ?? []);
                        if (event.target.checked) next.add(device.id);
                        else next.delete(device.id);
                        return { ...prev, [openGroup.id]: next };
                      })
                    }
                  />
                  <span className={`device-dot device-dot--${device.currentStatus.toLowerCase()}`} />
                  <span style={{ fontWeight: 600 }}>{device.name}</span>
                  <small>{device.channelAddress ?? device.code}</small>
                  <button type="button" onClick={() => runDeviceCommands(openGroup, [device], "turn_on")}>ON</button>
                  <button type="button" onClick={() => runDeviceCommands(openGroup, [device], "turn_off")}>OFF</button>
                </label>
              ))}
            </div>

            <div className="modal-actions">
              <button type="button" onClick={() => setOpenGroupId(null)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {activeProgress.length > 0 && (
        <aside className="group-control__progress">
          <h3>진행 상태</h3>
          {activeProgress.map(([groupId, progress]) => {
            const completed = progress.trackers.filter((tracker) => TERMINAL_STATUSES.has(tracker.status)).length;
            const percent = progress.total > 0 ? Math.round((completed / progress.total) * 100) : 0;
            return (
              <div key={groupId} className="group-progress">
                <div className="group-progress__top">
                  <strong>{progress.label}</strong>
                  <span>{progress.issuing ? "명령 발행 중" : `${completed}/${progress.total}`}</span>
                </div>
                <div className="group-progress__bar">
                  <span style={{ width: `${progress.issuing ? 12 : percent}%` }} />
                </div>
                {progress.intervalMs !== undefined && (
                  <small>순차 발행 간격 {progress.intervalMs}ms</small>
                )}
                {progress.errors.map((item) => <p key={item} className="error-text">{item}</p>)}
                <ul>
                  {progress.trackers.slice(0, 8).map((tracker) => (
                    <li key={tracker.commandId}>
                      <span>{tracker.deviceName}</span>
                      <b>{statusText(tracker.status)}</b>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </aside>
      )}
    </section>
  );
}
