import { useEffect, useMemo, useState } from "react";
import { ApiError, listDevices, listFloors } from "../lib/api";
import type { DeviceListItem, FloorSummary } from "../lib/types";

/**
 * 차단기(접점) 전체 모니터링 — 레거시 "분전반 환경감시" 화면 재현.
 * 층(행) × 접점(도트) 매트릭스로 건물 전체 상태를 한 화면에서 일괄 감시한다.
 * 색상 레전드: 비상(ON) / 일반(ON) / 비상(OFF) / 일반(OFF) / SP / 알람.
 */
type ContactClass = "EMG_ON" | "NRM_ON" | "EMG_OFF" | "NRM_OFF" | "SP" | "ALARM";

const CONTACT_COLOR: Record<ContactClass, string> = {
  EMG_ON: "#f39c12", // 비상 ON — 주황
  NRM_ON: "#f4d03f", // 일반 ON — 노랑
  EMG_OFF: "#27ae60", // 비상 OFF — 진초록
  NRM_OFF: "#b0b8bf", // 일반 OFF — 회색
  SP: "#ffffff", // 예비/오프라인 — 흰색(빈 접점)
  ALARM: "#111827", // 알람 — 검정
};

const CONTACT_LABEL: Record<ContactClass, string> = {
  EMG_ON: "비상(ON)",
  NRM_ON: "일반(ON)",
  EMG_OFF: "비상(OFF)",
  NRM_OFF: "일반(OFF)",
  SP: "SP",
  ALARM: "알람",
};

const LEGEND_ORDER: ContactClass[] = ["EMG_ON", "NRM_ON", "EMG_OFF", "NRM_OFF", "SP", "ALARM"];

/**
 * 비상/일반은 **조명(전등) 차단기**의 비상등/일반등 구분이며, 오직 load_class로만 판정한다.
 * (전열·화재감지기 등 조명이 아닌 접점은 이 축과 무관 → 비상 아님.)
 */
function isEmergency(device: DeviceListItem): boolean {
  return device.loadClass === "EMERGENCY";
}

function contactClass(device: DeviceListItem): ContactClass {
  if (device.currentStatus === "ALARM" || device.currentStatus === "WARNING") return "ALARM";
  if (device.loadClass === "RESERVE" || device.currentStatus === "OFFLINE") return "SP";
  const on = device.currentStatus === "ON";
  return isEmergency(device) ? (on ? "EMG_ON" : "EMG_OFF") : on ? "NRM_ON" : "NRM_OFF";
}

/** 층 정렬 랭크: 지상 N층=N, 지하 BN층=-N, M(중간층)=0.5. 내림차순으로 고층이 위. */
function floorRank(name: string): number {
  const m = name.trim().toUpperCase();
  if (m === "M" || m === "MF") return 0.5;
  const basement = m.match(/^B(\d+)/);
  if (basement) return -Number(basement[1]);
  const above = m.match(/^(\d+)/);
  if (above) return Number(above[1]);
  return 0;
}

/** areaTopicPrefix(enterprise/site/bldg/floor/area)에서 floor 프리픽스(앞 4세그먼트)를 뽑는다. */
function floorPrefixFromArea(topic: string | null): string | null {
  if (!topic) return null;
  const parts = topic.split("/");
  return parts.length >= 5 ? parts.slice(0, 4).join("/") : null;
}

interface EquipmentGroup {
  key: string;
  equipment: DeviceListItem | null;
  contacts: DeviceListItem[];
}

interface FloorRow {
  floor: FloorSummary;
  groups: EquipmentGroup[];
}

interface FullMonitoringProps {
  /** 감시장비(RMU) 선택 → 해당 감시장비의 개별 제어(접점별) 화면으로 이동. */
  onSelectEquipment?: (equipment: DeviceListItem, floor: FloorSummary) => void;
}

export function FullMonitoring({ onSelectEquipment }: FullMonitoringProps): JSX.Element {
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

  // 건물 간 slug 충돌을 피하려고 floor.topicPrefix(고유)로 매핑한다.
  const floorByPrefix = useMemo(() => {
    const map = new Map<string, FloorSummary>();
    for (const floor of floors) map.set(floor.topicPrefix, floor);
    return map;
  }, [floors]);

  // 접점 → 소속 감시장비(RMU) 매핑용.
  const equipmentById = useMemo(() => {
    const map = new Map<string, DeviceListItem>();
    for (const device of devices) {
      if (device.deviceRole === "MONITORING_EQUIPMENT") map.set(device.id, device);
    }
    return map;
  }, [devices]);

  const rows = useMemo<FloorRow[]>(() => {
    const byFloor = new Map<string, { floor: FloorSummary; groups: Map<string, EquipmentGroup> }>();
    for (const device of devices) {
      if (device.deviceRole !== "SENSOR") continue;
      if (!(device.monitoringVisible && device.enabled && device.lifecycleStatus !== "DECOMMISSIONED")) continue;
      const prefix = floorPrefixFromArea(device.areaTopicPrefix);
      if (!prefix) continue;
      const floor = floorByPrefix.get(prefix);
      if (!floor) continue;
      const floorEntry = byFloor.get(floor.id) ?? { floor, groups: new Map<string, EquipmentGroup>() };
      const key = device.parentDeviceId ?? "__none__";
      const group =
        floorEntry.groups.get(key) ??
        ({ key, equipment: device.parentDeviceId ? equipmentById.get(device.parentDeviceId) ?? null : null, contacts: [] } as EquipmentGroup);
      group.contacts.push(device);
      floorEntry.groups.set(key, group);
      byFloor.set(floor.id, floorEntry);
    }
    const list: FloorRow[] = [];
    for (const { floor, groups } of byFloor.values()) {
      const groupList = [...groups.values()];
      for (const group of groupList) {
        group.contacts.sort((a, b) =>
          (a.channelAddress ?? a.name).localeCompare(b.channelAddress ?? b.name, undefined, { numeric: true }),
        );
      }
      // 감시장비를 지역/이름 순으로 정렬(도트 클러스터 순서 안정화).
      groupList.sort((a, b) =>
        (a.equipment?.areaTopicPrefix ?? "").localeCompare(b.equipment?.areaTopicPrefix ?? "") ||
        (a.equipment?.name ?? "~").localeCompare(b.equipment?.name ?? "~"),
      );
      list.push({ floor, groups: groupList });
    }
    list.sort((a, b) => floorRank(b.floor.name) - floorRank(a.floor.name));
    return list;
  }, [devices, floorByPrefix, equipmentById]);

  const totals = useMemo(() => {
    const acc: Record<ContactClass, number> = { EMG_ON: 0, NRM_ON: 0, EMG_OFF: 0, NRM_OFF: 0, SP: 0, ALARM: 0 };
    for (const row of rows) for (const group of row.groups) for (const contact of group.contacts) acc[contactClass(contact)] += 1;
    return acc;
  }, [rows]);

  const contactCount = rows.reduce(
    (sum, row) => sum + row.groups.reduce((s, g) => s + g.contacts.length, 0),
    0,
  );

  if (loading) return <p>전체 상태를 불러오는 중…</p>;
  if (error) return <p className="error-text">{error}</p>;

  return (
    <div className="full-monitoring">
      <div className="full-monitoring__head">
        <div>
          <h2>분전반 환경감시 — 차단기 전체 모니터링</h2>
          <p className="full-monitoring__sub">
            {rows.length}개 층 · 접점 {contactCount}개 일괄 감시
          </p>
        </div>
        <div className="full-monitoring__legend">
          {LEGEND_ORDER.map((key) => (
            <span key={key} className="full-monitoring__legend-item">
              <i className={`fm-dot ${key === "SP" ? "hollow" : ""}`} style={{ background: CONTACT_COLOR[key] }} />
              {CONTACT_LABEL[key]} <b>{totals[key]}</b>
            </span>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="full-monitoring__empty">표시할 접점이 없습니다.</p>
      ) : (
        <div className="full-monitoring__grid">
          {rows.map(({ floor, groups }) => (
            <div key={floor.id} className="full-monitoring__row">
              <span className="full-monitoring__floor" title={`${floor.siteName} · ${floor.buildingName}`}>
                {floor.name}
              </span>
              <div className="full-monitoring__equipments">
                {groups.map((group) => {
                  const clickable = group.equipment !== null && onSelectEquipment !== undefined;
                  const dots = group.contacts.map((contact) => {
                    const cls = contactClass(contact);
                    return (
                      <i
                        key={contact.id}
                        className={`fm-dot ${cls === "SP" ? "hollow" : ""}`}
                        style={{ background: CONTACT_COLOR[cls] }}
                        title={`${contact.name} · ${CONTACT_LABEL[cls]}${
                          contact.channelAddress ? ` · 접점 ${contact.channelAddress}` : ""
                        } (${contact.currentStatus})`}
                      />
                    );
                  });
                  const title = group.equipment
                    ? `${group.equipment.name} — 클릭하면 개별 제어`
                    : "미지정 감시장비";
                  return clickable ? (
                    <button
                      key={group.key}
                      type="button"
                      className="full-monitoring__equipment is-clickable"
                      title={title}
                      onClick={() => onSelectEquipment?.(group.equipment as DeviceListItem, floor)}
                    >
                      {dots}
                    </button>
                  ) : (
                    <span key={group.key} className="full-monitoring__equipment" title={title}>
                      {dots}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
