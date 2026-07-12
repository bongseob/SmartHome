import { useEffect, useMemo, useState } from "react";
import { ApiError, listDevices, listFloors } from "../lib/api";
import type { DeviceListItem, FloorSummary } from "../lib/types";

/**
 * 차단기 전체 모니터링 — 층별 요약 화면.
 * 전열/전등을 배경색으로 구분하고, 각 층의 ON/OFF/빈(empty) 접점 개수를 숫자로 표시한다.
 * 상태등: All ON(빨강) / All OFF(회색) / 혼합(노랑).
 * 안전 규칙: 전열은 원격 제어 없이 상태만 모니터링, 전등만 제어(층 클릭 시 관제로 이동)한다.
 */

type FloorStatus = "ALL_ON" | "ALL_OFF" | "MIXED" | "NONE";

const STATUS_COLOR: Record<FloorStatus, string> = {
  ALL_ON: "#e74c3c", // 전체 ON — 빨강
  ALL_OFF: "#94a3b8", // 전체 OFF — 회색
  MIXED: "#f1c40f", // 혼합 — 노랑
  NONE: "#e2e8f0", // 접점 없음
};

interface TypeSummary {
  total: number;
  on: number;
  off: number;
  empty: number;
  status: FloorStatus;
}

interface FloorRow {
  floor: FloorSummary;
  lighting: TypeSummary; // 전등 (제어 가능)
  power: TypeSummary; // 전열 (모니터 전용)
}

/** 전등(조명) 여부 — deviceType 'light'(일반등/비상등). 그 외(에어컨·화재감지기 등)는 전열/기타. */
function isLighting(device: DeviceListItem): boolean {
  return (device.deviceType ?? "").toLowerCase() === "light";
}

/** 접점을 ON / OFF / 빈(empty)으로 분류. OFFLINE·예비(RESERVE)는 빈, ALARM/WARNING은 OFF로 집계. */
function bucketOf(device: DeviceListItem): "on" | "off" | "empty" {
  if (device.currentStatus === "OFFLINE" || device.loadClass === "RESERVE") return "empty";
  if (device.currentStatus === "ON") return "on";
  return "off";
}

function emptySummary(): TypeSummary {
  return { total: 0, on: 0, off: 0, empty: 0, status: "NONE" };
}

function finalizeStatus(summary: TypeSummary): FloorStatus {
  const active = summary.on + summary.off; // 빈 제외
  if (active === 0) return "NONE";
  if (summary.off === 0) return "ALL_ON";
  if (summary.on === 0) return "ALL_OFF";
  return "MIXED";
}

function floorRank(name: string): number {
  const m = name.trim().toUpperCase();
  if (m === "M" || m === "MF") return 0.5;
  const basement = m.match(/^B(\d+)/);
  if (basement) return -Number(basement[1]);
  const above = m.match(/^(\d+)/);
  if (above) return Number(above[1]);
  return 0;
}

function floorPrefixFromArea(topic: string | null): string | null {
  if (!topic) return null;
  const parts = topic.split("/");
  return parts.length >= 5 ? parts.slice(0, 4).join("/") : null;
}

interface FullMonitoringProps {
  /** 전등(제어 가능) 층 클릭 → 해당 층 관제(개별 제어) 화면으로 이동. 전열은 호출하지 않는다. */
  onOpenLightingControl?: (floor: FloorSummary) => void;
}

export function FullMonitoring({ onOpenLightingControl }: FullMonitoringProps): JSX.Element {
  const [floors, setFloors] = useState<FloorSummary[]>([]);
  const [devices, setDevices] = useState<DeviceListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listFloors(), listDevices()])
      .then(([f, d]) => {
        if (cancelled) return;
        setFloors(f);
        setDevices(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ApiError ? e.detail : "전체 상태를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const floorByPrefix = useMemo(() => {
    const map = new Map<string, FloorSummary>();
    for (const floor of floors) map.set(floor.topicPrefix, floor);
    return map;
  }, [floors]);

  const rows = useMemo<FloorRow[]>(() => {
    const byFloor = new Map<string, FloorRow>();
    for (const device of devices) {
      if (device.deviceRole !== "SENSOR") continue;
      if (!(device.monitoringVisible && device.enabled && device.lifecycleStatus !== "DECOMMISSIONED")) continue;
      const prefix = floorPrefixFromArea(device.areaTopicPrefix);
      if (!prefix) continue;
      const floor = floorByPrefix.get(prefix);
      if (!floor) continue;
      const row =
        byFloor.get(floor.id) ?? { floor, lighting: emptySummary(), power: emptySummary() };
      const target = isLighting(device) ? row.lighting : row.power;
      const bucket = bucketOf(device);
      target.total += 1;
      target[bucket] += 1;
      byFloor.set(floor.id, row);
    }
    const list = [...byFloor.values()];
    for (const row of list) {
      row.lighting.status = finalizeStatus(row.lighting);
      row.power.status = finalizeStatus(row.power);
    }
    list.sort((a, b) => floorRank(b.floor.name) - floorRank(a.floor.name));
    return list;
  }, [devices, floorByPrefix]);

  if (loading) return <p>전체 상태를 불러오는 중…</p>;
  if (error) return <p className="error-text">{error}</p>;

  const lightingTotal = rows.reduce((s, r) => s + r.lighting.total, 0);
  const powerTotal = rows.reduce((s, r) => s + r.power.total, 0);

  return (
    <div className="full-monitoring">
      <div className="full-monitoring__head">
        <div>
          <h2>분전반 환경감시 — 차단기 전체 모니터링</h2>
          <p className="full-monitoring__sub">
            {rows.length}개 층 · 전등 {lightingTotal} · 전열 {powerTotal} 접점 · 전열은 안전상 모니터링 전용
          </p>
        </div>
        <div className="full-monitoring__legend">
          <span className="full-monitoring__legend-item">
            <i className="fm-status" style={{ background: STATUS_COLOR.ALL_ON }} /> All ON
          </span>
          <span className="full-monitoring__legend-item">
            <i className="fm-status" style={{ background: STATUS_COLOR.ALL_OFF }} /> All OFF
          </span>
          <span className="full-monitoring__legend-item">
            <i className="fm-status" style={{ background: STATUS_COLOR.MIXED }} /> 혼합
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="full-monitoring__empty">표시할 접점이 없습니다.</p>
      ) : (
        <div className="full-monitoring__tables">
          <SummaryTable
            title="전등"
            hint="클릭하면 개별 제어"
            variant="lighting"
            rows={rows}
            pick={(row) => row.lighting}
            onOpen={onOpenLightingControl}
          />
          <SummaryTable
            title="전열"
            hint="모니터링 전용 (원격 제어 불가)"
            variant="power"
            rows={rows}
            pick={(row) => row.power}
          />
        </div>
      )}
    </div>
  );
}

interface SummaryTableProps {
  title: string;
  hint: string;
  variant: "lighting" | "power";
  rows: FloorRow[];
  pick: (row: FloorRow) => TypeSummary;
  onOpen?: (floor: FloorSummary) => void;
}

function SummaryTable({ title, hint, variant, rows, pick, onOpen }: SummaryTableProps): JSX.Element {
  return (
    <div className={`fm-summary-wrap fm-summary--${variant}`}>
      <div className="fm-summary__cap">
        <strong>{title}</strong>
        <span className="fm-summary__hint">{hint}</span>
      </div>
      <table className="fm-summary__table">
        <thead>
          <tr>
            <th className="fm-summary__st">상태</th>
            <th className="fm-summary__floor">지역</th>
            <th>TOT</th>
            <th>ON</th>
            <th>OFF</th>
            <th>빈</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const s = pick(row);
            const clickable = onOpen !== undefined && s.total > 0;
            const handle = clickable ? () => onOpen?.(row.floor) : undefined;
            return (
              <tr
                key={row.floor.id}
                className={clickable ? "is-clickable" : undefined}
                onClick={handle}
                title={clickable ? `${row.floor.name} ${title} 개별 제어로 이동` : undefined}
              >
                <td className="fm-summary__st">
                  <i className="fm-status" style={{ background: STATUS_COLOR[s.status] }} />
                </td>
                <td className="fm-summary__floor">{row.floor.name}</td>
                <td>{s.total}</td>
                <td>{s.on}</td>
                <td>{s.off}</td>
                <td>{s.empty}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
