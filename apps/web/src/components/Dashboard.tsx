import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { BarChart as EChartsBarChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import { ApiError, listDevices, listFloors } from "../lib/api";
import type { DeviceListItem, FloorSummary } from "../lib/types";

type DeviceKind = "light" | "aircon" | "fire_detector" | "other";

echarts.use([EChartsBarChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface FloorStat {
  floorId: string;
  floorName: string;
  total: number;
  on: number;
  off: number;
  warning: number;
  alarm: number;
  offline: number;
}

const KIND_LABEL: Record<DeviceKind, string> = {
  light: "전등",
  aircon: "에어컨",
  fire_detector: "화재감지기",
  other: "기타",
};

function deviceKind(device: DeviceListItem): DeviceKind {
  const type = (device.deviceType ?? "").toLowerCase();
  if (type.includes("light")) return "light";
  if (type.includes("aircon") || type.includes("hvac")) return "aircon";
  if (type.includes("fire")) return "fire_detector";
  return "other";
}

function floorSlugFromTopic(topic: string): string | null {
  const parts = topic.split("/");
  return parts.length >= 5 ? parts[3] ?? null : null;
}

function percent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function StatCard({ label, value, hint }: { label: string; value: number | string; hint: string }): JSX.Element {
  return (
    <section className="dashboard-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </section>
  );
}

function EChart({ option, height }: { option: EChartsOption; height: number }): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = echarts.init(container);
    chart.setOption(option);
    const resize = (): void => chart.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [option]);

  return <div ref={containerRef} className="dashboard-chart" style={{ height }} />;
}

function BarChart({ rows }: { rows: Array<{ label: string; value: number }> }): JSX.Element {
  const option = useMemo<EChartsOption>(() => ({
    grid: { left: 70, right: 28, top: 12, bottom: 24 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "value", splitLine: { lineStyle: { color: "#eef2f7" } } },
    yAxis: {
      type: "category",
      data: rows.map((row) => row.label),
      axisTick: { show: false },
      axisLine: { show: false },
    },
    series: [
      {
        type: "bar",
        data: rows.map((row) => row.value),
        barMaxWidth: 24,
        itemStyle: { color: "#2563eb", borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: "right", color: "#172033", fontWeight: 700 },
      },
    ],
  }), [rows]);

  return <EChart option={option} height={Math.max(160, rows.length * 42)} />;
}

function FloorStatusChart({ rows }: { rows: FloorStat[] }): JSX.Element {
  const option = useMemo<EChartsOption>(() => ({
    color: ["#16a34a", "#cbd5e1", "#f59e0b", "#dc2626", "#111827"],
    grid: { left: 58, right: 28, top: 12, bottom: 24 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { bottom: 0, itemWidth: 10, itemHeight: 10 },
    xAxis: { type: "value", splitLine: { lineStyle: { color: "#eef2f7" } } },
    yAxis: {
      type: "category",
      data: rows.map((row) => row.floorName),
      axisTick: { show: false },
      axisLine: { show: false },
    },
    series: [
      { name: "ON", type: "bar", stack: "total", data: rows.map((row) => row.on) },
      { name: "OFF", type: "bar", stack: "total", data: rows.map((row) => row.off) },
      { name: "WARNING", type: "bar", stack: "total", data: rows.map((row) => row.warning) },
      { name: "ALARM", type: "bar", stack: "total", data: rows.map((row) => row.alarm) },
      { name: "OFFLINE", type: "bar", stack: "total", data: rows.map((row) => row.offline) },
    ],
  }), [rows]);

  return <EChart option={option} height={Math.max(260, rows.length * 28)} />;
}

export function Dashboard(): JSX.Element {
  const [floors, setFloors] = useState<FloorSummary[]>([]);
  const [devices, setDevices] = useState<DeviceListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listFloors(), listDevices()])
      .then(([floorResult, deviceResult]) => {
        setFloors(floorResult);
        setDevices(deviceResult);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.detail : "대시보드 데이터를 불러오지 못했습니다.");
      });
  }, []);

  const stats = useMemo(() => {
    const bySlug = new Map(floors.map((floor) => [floor.slug, floor]));
    const floorStats = new Map<string, FloorStat>();
    const byKind: Record<DeviceKind, number> = { light: 0, aircon: 0, fire_detector: 0, other: 0 };
    const byStatus = { on: 0, off: 0, warning: 0, alarm: 0, offline: 0 };
    const byAreaType: Record<string, number> = { toilet: 0, corridor: 0, stairs: 0, office: 0 };

    for (const floor of floors) {
      floorStats.set(floor.id, {
        floorId: floor.id,
        floorName: floor.name,
        total: 0,
        on: 0,
        off: 0,
        warning: 0,
        alarm: 0,
        offline: 0,
      });
    }

    for (const device of devices) {
      if (
        device.deviceRole !== "SENSOR" ||
        !device.monitoringVisible ||
        !device.enabled ||
        device.lifecycleStatus === "DECOMMISSIONED"
      ) {
        continue;
      }
      byKind[deviceKind(device)] += 1;
      if (device.currentStatus === "ON") byStatus.on += 1;
      else if (device.currentStatus === "OFF") byStatus.off += 1;
      else if (device.currentStatus === "WARNING") byStatus.warning += 1;
      else if (device.currentStatus === "ALARM") byStatus.alarm += 1;
      else byStatus.offline += 1;

      const topicParts = device.mqttTopic.split("/");
      const areaSlug = topicParts[4] ?? "";
      if (areaSlug in byAreaType) byAreaType[areaSlug] += 1;

      const floor = bySlug.get(floorSlugFromTopic(device.mqttTopic) ?? "");
      if (!floor) continue;
      const stat = floorStats.get(floor.id);
      if (!stat) continue;
      stat.total += 1;
      if (device.currentStatus === "ON") stat.on += 1;
      else if (device.currentStatus === "OFF") stat.off += 1;
      else if (device.currentStatus === "WARNING") stat.warning += 1;
      else if (device.currentStatus === "ALARM") stat.alarm += 1;
      else stat.offline += 1;
    }

    const floorRows = [...floorStats.values()].filter((row) => row.total > 0);
    return { byKind, byStatus, byAreaType, floorRows };
  }, [devices, floors]);

  const total = devices.filter(
    (device) =>
      device.deviceRole === "SENSOR" &&
      device.monitoringVisible &&
      device.enabled &&
      device.lifecycleStatus !== "DECOMMISSIONED",
  ).length;
  const normal = stats.byStatus.on + stats.byStatus.off;
  const attention = stats.byStatus.warning + stats.byStatus.alarm + stats.byStatus.offline;
  const maxFloorTotal = Math.max(0, ...stats.floorRows.map((row) => row.total));

  const kindRows = (Object.entries(stats.byKind) as Array<[DeviceKind, number]>)
    .filter(([, value]) => value > 0)
    .map(([kind, value]) => ({ label: KIND_LABEL[kind], value }));

  const areaRows = [
    { label: "화장실", value: stats.byAreaType.toilet },
    { label: "복도", value: stats.byAreaType.corridor },
    { label: "계단", value: stats.byAreaType.stairs },
    { label: "사무실", value: stats.byAreaType.office },
  ];

  return (
    <main className="dashboard">
      <header className="dashboard__header">
        <div>
          <h2>통합 대시보드</h2>
          <p>건물 전체 설비 상태, 층별 분포, 용도별 설비 구성을 요약합니다.</p>
        </div>
        <span>{floors.length}개 층 · {total}개 기기</span>
      </header>

      {error && <p className="error-text">{error}</p>}

      <div className="dashboard-grid">
        <StatCard label="전체 설비" value={total} hint="전등, 에어컨, 화재감지기" />
        <StatCard label="정상 상태" value={`${percent(normal, total)}%`} hint={`${normal}개 ON/OFF 정상`} />
        <StatCard label="주의 필요" value={attention} hint="WARNING/ALARM/OFFLINE" />
        <StatCard label="화재감지기" value={stats.byKind.fire_detector} hint="센서 모니터링 대상" />
      </div>

      <div className="dashboard-panels">
        <section className="dashboard-panel">
          <h3>설비 유형 분포</h3>
          <BarChart rows={kindRows} />
        </section>
        <section className="dashboard-panel">
          <h3>그룹별 분포</h3>
          <BarChart rows={areaRows} />
        </section>
      </div>

      <section className="dashboard-panel">
        <h3>층별 모니터링 현황</h3>
        {stats.floorRows.length > 0 ? <FloorStatusChart rows={stats.floorRows} /> : <p className="dashboard__empty">표시할 샘플 데이터가 없습니다.</p>}
        {maxFloorTotal > 0 && <small className="dashboard-panel__legend">녹색 ON · 회색 OFF · 노랑 WARNING · 빨강 ALARM · 검정 OFFLINE</small>}
      </section>
    </main>
  );
}
