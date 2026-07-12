import { useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from "react-konva";
import type { DeviceStatus } from "@smarthome/contracts";
import type { Area, DeviceListItem, FloorOverview } from "../lib/types";
import { DEVICE_STATUS_COLOR } from "../lib/status";
import { apiAssetUrl } from "../lib/api";
import { useHtmlImage } from "../lib/useHtmlImage";

const FALLBACK_WIDTH = 800;
const FALLBACK_HEIGHT = 600;
const MIN_SCALE = 0.3;
const MAX_SCALE = 4;
const MIN_STAGE_WIDTH = 360;
const MIN_STAGE_HEIGHT = 420;
/** 마커가 도면 밖으로 나가지 않도록 반지름+여백만큼 안쪽으로 제한한다. */
const MARKER_EDGE_MARGIN = 12;
type MonitoringLevel = "equipment" | "sensor";

interface EquipmentSummary {
  total: number;
  on: number;
  off: number;
  warning: number;
  alarm: number;
  offline: number;
  status: DeviceStatus;
}

function polygonPoints(polygon: unknown): number[] | null {
  if (!Array.isArray(polygon)) return null;
  const points: number[] = [];
  for (const vertex of polygon) {
    if (!Array.isArray(vertex) || vertex.length < 2) return null;
    const [x, y] = vertex;
    if (typeof x !== "number" || typeof y !== "number") return null;
    points.push(x, y);
  }
  return points.length >= 6 ? points : null; // 최소 삼각형(3점)
}

function devicePosition(
  device: DeviceListItem,
  fallbackIndex: number,
  override?: { x: number; y: number },
): { x: number; y: number } {
  if (override) return override;
  const x = device.posX !== null ? Number(device.posX) : NaN;
  const y = device.posY !== null ? Number(device.posY) : NaN;
  if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  // 좌표가 없는 기기는 좌상단부터 줄지어 배치해 최소한 보이게 한다.
  return { x: 24 + (fallbackIndex % 6) * 32, y: 24 + Math.floor(fallbackIndex / 6) * 32 };
}

function isActiveMonitoringDevice(device: DeviceListItem): boolean {
  return device.monitoringVisible && device.enabled && device.lifecycleStatus !== "DECOMMISSIONED";
}

function summarizeSensors(equipment: DeviceListItem, sensors: DeviceListItem[]): EquipmentSummary {
  const total = sensors.length;
  const on = sensors.filter((device) => device.currentStatus === "ON").length;
  const off = sensors.filter((device) => device.currentStatus === "OFF").length;
  const warning = sensors.filter((device) => device.currentStatus === "WARNING").length;
  const alarm = sensors.filter((device) => device.currentStatus === "ALARM").length;
  const offline = sensors.filter((device) => device.currentStatus === "OFFLINE").length;
  let status: DeviceStatus = equipment.currentStatus;
  if (total > 0) {
    if (alarm > 0) status = "ALARM";
    else if (warning > 0) status = "WARNING";
    else if (offline > 0) status = "OFFLINE";
    else if (on === total) status = "ON";
    else if (off === total) status = "OFF";
    else status = "WARNING";
  }
  return { total, on, off, warning, alarm, offline, status };
}

function sensorLabel(device: DeviceListItem): string {
  return device.channelAddress ? `${device.channelAddress} ${device.name}` : device.name;
}

function fitMapToViewport(
  viewport: { width: number; height: number },
  map: { width: number; height: number },
): { scale: number; pos: { x: number; y: number } } {
  // cover: 도면 이미지가 뷰포트 영역을 빈틈없이 꽉 채우도록 더 큰 배율로 맞춘다(넘치는 축은 중앙 크롭).
  const fitScale = Math.max(viewport.width / map.width, viewport.height / map.height);
  const safeScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, fitScale));
  return {
    scale: safeScale,
    pos: {
      x: (viewport.width - map.width * safeScale) / 2,
      y: (viewport.height - map.height * safeScale) / 2,
    },
  };
}

/** 접점(자식 센서)을 접점주소 기준으로 안정 정렬한다. */
function sortContacts(sensors: DeviceListItem[]): DeviceListItem[] {
  return [...sensors].sort((a, b) =>
    (a.channelAddress ?? a.name).localeCompare(b.channelAddress ?? b.name, undefined, { numeric: true }),
  );
}

interface FloorMapProps {
  overview: FloorOverview;
  selectedDeviceId: string | null;
  onSelectDevice: (device: DeviceListItem) => void;
  /** 편집 모드: 기기 마커를 드래그로 옮길 수 있다(ui-ux-design.md §4.1-mode). 기본 false(실행 모드). */
  editMode?: boolean;
  /** 저장 전 임시 위치(드래그했지만 아직 저장하지 않은 좌표) — deviceId별 override. */
  pendingPositions?: Record<string, { x: number; y: number }>;
  onDeviceDragEnd?: (deviceId: string, x: number, y: number) => void;
  /** 외부(전체 모니터링)에서 특정 감시장비의 접점별 개별 제어를 펼치라는 요청. */
  focusEquipmentId?: string | null;
  /** 포커스를 적용한 뒤 부모의 상태를 비우도록 알린다(중복 적용 방지). */
  onFocusHandled?: () => void;
}

export function FloorMap({
  overview,
  selectedDeviceId,
  onSelectDevice,
  editMode = false,
  pendingPositions = {},
  onDeviceDragEnd,
  focusEquipmentId = null,
  onFocusHandled,
}: FloorMapProps): JSX.Element {
  const width = overview.floor.floorMapWidth ?? FALLBACK_WIDTH;
  const height = overview.floor.floorMapHeight ?? FALLBACK_HEIGHT;
  const image = useHtmlImage(apiAssetUrl(overview.floor.floorMapUrl));
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [stageSize, setStageSize] = useState({
    width: Math.min(width, 1000),
    height: Math.min(height, 700),
  });
  const [monitoringLevel, setMonitoringLevel] = useState<MonitoringLevel>("equipment");
  // 지역(Area) 선택 — 선택 시 해당 지역 감시장비만 보여준다(요구: 지역 선택 → 감시장비 레벨).
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  // 감시장비 호버 → 일괄 상태 툴팁. 클릭(접점별 패널)과 분리된 상호작용이다.
  const [hoveredEquipmentId, setHoveredEquipmentId] = useState<string | null>(null);
  // 감시장비 클릭 → 접점별 상태 패널 대상.
  const [contactsEquipmentId, setContactsEquipmentId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null);

  // 층이 바뀌면 지역/호버/접점 선택을 초기화한다(이전 층의 잔상 방지).
  useEffect(() => {
    setSelectedAreaId(null);
    setHoveredEquipmentId(null);
    setContactsEquipmentId(null);
  }, [overview.floor.id]);

  useEffect(() => {
    const container = stageContainerRef.current;
    if (!container) return;

    const updateSize = (): void => {
      const rect = container.getBoundingClientRect();
      const nextSize = {
        width: Math.max(MIN_STAGE_WIDTH, Math.floor(rect.width)),
        height: Math.max(MIN_STAGE_HEIGHT, Math.floor(rect.height)),
      };
      setStageSize((current) =>
        current.width === nextSize.width && current.height === nextSize.height ? current : nextSize,
      );
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const fitted = fitMapToViewport(stageSize, { width, height });
    setScale(fitted.scale);
    setPos(fitted.pos);
  }, [overview.floor.id, stageSize, width, height]);

  const areasWithPoints = useMemo(
    () =>
      overview.areas
        .map((area: Area) => ({ area, points: polygonPoints(area.polygon) }))
        .filter((entry): entry is { area: Area; points: number[] } => entry.points !== null),
    [overview.areas],
  );

  const activeDevices = useMemo(
    () => overview.devices.filter(isActiveMonitoringDevice),
    [overview.devices],
  );

  const sensors = useMemo(
    () => activeDevices.filter((device) => device.deviceRole === "SENSOR"),
    [activeDevices],
  );

  const equipments = useMemo(
    () => activeDevices.filter((device) => device.deviceRole === "MONITORING_EQUIPMENT"),
    [activeDevices],
  );

  // 외부(전체 모니터링)에서 감시장비를 선택하면 그 감시장비의 지역으로 필터하고 접점별 패널을 펼친다.
  // 층 변경 → overview 로드 완료(해당 감시장비가 equipments에 존재) 시점에 적용한다.
  useEffect(() => {
    if (!focusEquipmentId) return;
    const target = equipments.find((device) => device.id === focusEquipmentId);
    if (!target) return; // 아직 해당 층 overview가 로드되지 않음 → 다음 렌더에서 재시도
    setSelectedAreaId(target.areaId);
    setMonitoringLevel("equipment");
    setHoveredEquipmentId(null);
    setContactsEquipmentId(focusEquipmentId);
    onFocusHandled?.();
  }, [focusEquipmentId, equipments, onFocusHandled]);

  const sensorsByEquipment = useMemo(() => {
    const result = new Map<string, DeviceListItem[]>();
    for (const sensor of sensors) {
      if (!sensor.parentDeviceId) continue;
      const current = result.get(sensor.parentDeviceId) ?? [];
      current.push(sensor);
      result.set(sensor.parentDeviceId, current);
    }
    return result;
  }, [sensors]);

  // 지역 필터: 선택된 지역이 있으면 그 지역 소속 기기만 렌더한다.
  const areaMatch = (device: DeviceListItem): boolean =>
    selectedAreaId === null || device.areaId === selectedAreaId;
  const visibleEquipments = useMemo(() => equipments.filter(areaMatch), [equipments, selectedAreaId]);
  const visibleSensors = useMemo(() => sensors.filter(areaMatch), [sensors, selectedAreaId]);

  const renderedDevices = monitoringLevel === "equipment" ? visibleEquipments : visibleSensors;

  const hoveredEquipment = hoveredEquipmentId
    ? equipments.find((device) => device.id === hoveredEquipmentId) ?? null
    : null;
  const hoveredSummary = hoveredEquipment
    ? summarizeSensors(hoveredEquipment, sensorsByEquipment.get(hoveredEquipment.id) ?? [])
    : null;

  const contactsEquipment = contactsEquipmentId
    ? equipments.find((device) => device.id === contactsEquipmentId) ?? null
    : null;
  const contactsSensors = contactsEquipment
    ? sortContacts(sensorsByEquipment.get(contactsEquipment.id) ?? [])
    : [];
  const contactsSummary = contactsEquipment
    ? summarizeSensors(contactsEquipment, contactsSensors)
    : null;

  function selectArea(areaId: string | null): void {
    setSelectedAreaId(areaId);
    setContactsEquipmentId(null);
    setHoveredEquipmentId(null);
    // 요구: 지역을 선택하면 감시장비 레벨로 본다.
    if (areaId !== null) setMonitoringLevel("equipment");
  }

  function setCursor(event: Konva.KonvaEventObject<MouseEvent>, cursor: string): void {
    const container = event.target.getStage()?.container();
    if (container) container.style.cursor = cursor;
  }

  function handleWheel(event: Konva.KonvaEventObject<WheelEvent>): void {
    event.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const direction = event.evt.deltaY > 0 ? -1 : 1;
    const factor = 1.05;
    const nextScale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, direction > 0 ? scale * factor : scale / factor),
    );

    const mousePointTo = {
      x: (pointer.x - pos.x) / scale,
      y: (pointer.y - pos.y) / scale,
    };
    setScale(nextScale);
    setPos({
      x: pointer.x - mousePointTo.x * nextScale,
      y: pointer.y - mousePointTo.y * nextScale,
    });
  }

  const selectedAreaName = selectedAreaId
    ? overview.areas.find((area) => area.id === selectedAreaId)?.name ?? null
    : null;

  return (
    <div className="floor-map">
      <div className="floor-map__toolbar">
        <label className="floor-map__area-select">
          지역{" "}
          <select value={selectedAreaId ?? ""} onChange={(e) => selectArea(e.target.value || null)}>
            <option value="">전체</option>
            {overview.areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </select>
        </label>
        <div className="floor-map__level-toggle">
          <button
            type="button"
            className={monitoringLevel === "equipment" ? "active" : ""}
            onClick={() => setMonitoringLevel("equipment")}
          >
            감시장비
          </button>
          <button
            type="button"
            className={monitoringLevel === "sensor" ? "active" : ""}
            onClick={() => setMonitoringLevel("sensor")}
          >
            개별 센서
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            const fitted = fitMapToViewport(stageSize, { width, height });
            setScale(fitted.scale);
            setPos(fitted.pos);
          }}
        >
          초기화
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <span className="floor-map__level-summary">
          {selectedAreaName ? `${selectedAreaName} · ` : ""}
          {monitoringLevel === "equipment"
            ? `감시장비 ${visibleEquipments.length}대 / 센서 ${visibleSensors.length}개`
            : `개별 센서 ${visibleSensors.length}개`}
        </span>
        {selectedAreaId && (
          <button type="button" className="floor-map__area-clear" onClick={() => selectArea(null)}>
            전체 보기
          </button>
        )}
      </div>
      <div className="floor-map__stage" ref={stageContainerRef}>
        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          scaleX={scale}
          scaleY={scale}
          x={pos.x}
          y={pos.y}
          draggable={!editMode}
          onWheel={handleWheel}
          onDragEnd={(e) => {
            if (e.target !== e.target.getStage()) return;
            setPos({ x: e.target.x(), y: e.target.y() });
          }}
        >
        <Layer listening={false}>
          {image && <KonvaImage image={image} width={width} height={height} opacity={0.9} />}
        </Layer>
        <Layer>
          {areasWithPoints.map(({ area, points }) => {
            const isSelected = area.id === selectedAreaId;
            const dimmed = selectedAreaId !== null && !isSelected;
            return (
              <Line
                key={area.id}
                points={points}
                closed
                fill={isSelected ? "rgba(37, 99, 235, 0.22)" : dimmed ? "rgba(148, 163, 184, 0.08)" : "rgba(52, 152, 219, 0.12)"}
                stroke={isSelected ? "#2563eb" : "#3498db"}
                strokeWidth={isSelected ? 2.5 : 1.5}
                onMouseEnter={(e) => setCursor(e, "pointer")}
                onMouseLeave={(e) => setCursor(e, "default")}
                onClick={() => selectArea(isSelected ? null : area.id)}
                onTap={() => selectArea(isSelected ? null : area.id)}
              />
            );
          })}
          {areasWithPoints.map(({ area, points }) => (
            <Text
              key={`${area.id}-label`}
              x={points[0]}
              y={(points[1] ?? 0) - 18}
              text={area.name}
              fontSize={13}
              fontStyle={area.id === selectedAreaId ? "bold" : "normal"}
              fill={area.id === selectedAreaId ? "#1d4ed8" : "#2c3e50"}
              listening={false}
            />
          ))}
        </Layer>
        <Layer>
          {renderedDevices.map((device, index) => {
            const { x, y } =
              dragPreview?.id === device.id
                ? { x: dragPreview.x, y: dragPreview.y }
                : devicePosition(device, index, pendingPositions[device.id]);
            const isEquipment = device.deviceRole === "MONITORING_EQUIPMENT";
            const selected = isEquipment
              ? device.id === contactsEquipmentId
              : device.id === selectedDeviceId;
            const hovered = isEquipment && device.id === hoveredEquipmentId;
            const childSensors = sensorsByEquipment.get(device.id) ?? [];
            const summary = isEquipment ? summarizeSensors(device, childSensors) : null;
            const markerColor = summary
              ? DEVICE_STATUS_COLOR[summary.status]
              : DEVICE_STATUS_COLOR[device.currentStatus];
            const emphasized = selected || hovered;
            return (
              <Group
                key={device.id}
                x={x}
                y={y}
                draggable={editMode}
                dragBoundFunc={(absolutePos) => {
                  const localX = (absolutePos.x - pos.x) / scale;
                  const localY = (absolutePos.y - pos.y) / scale;
                  const clampedX = Math.min(Math.max(localX, MARKER_EDGE_MARGIN), width - MARKER_EDGE_MARGIN);
                  const clampedY = Math.min(Math.max(localY, MARKER_EDGE_MARGIN), height - MARKER_EDGE_MARGIN);
                  return { x: clampedX * scale + pos.x, y: clampedY * scale + pos.y };
                }}
                onMouseEnter={(e) => {
                  setCursor(e, "pointer");
                  if (isEquipment) setHoveredEquipmentId(device.id);
                }}
                onMouseLeave={(e) => {
                  setCursor(e, "default");
                  if (isEquipment) setHoveredEquipmentId((current) => (current === device.id ? null : current));
                }}
                onDragMove={(e) => {
                  e.cancelBubble = true;
                  setDragPreview({ id: device.id, x: e.target.x(), y: e.target.y() });
                }}
                onDragEnd={(e) => {
                  e.cancelBubble = true;
                  setDragPreview(null);
                  onDeviceDragEnd?.(device.id, e.target.x(), e.target.y());
                  e.target.getStage()?.batchDraw();
                }}
              >
                {isEquipment ? (
                  <>
                    <Rect
                      x={emphasized ? -14 : -12}
                      y={emphasized ? -14 : -12}
                      width={emphasized ? 28 : 24}
                      height={emphasized ? 28 : 24}
                      cornerRadius={5}
                      fill={markerColor}
                      stroke={selected ? "#111827" : hovered ? "#2563eb" : "#ffffff"}
                      strokeWidth={emphasized ? 2.5 : 1.5}
                      shadowColor="rgba(15, 23, 42, 0.35)"
                      shadowBlur={emphasized ? 9 : 6}
                      onClick={() => !editMode && setContactsEquipmentId((cur) => (cur === device.id ? null : device.id))}
                      onTap={() => !editMode && setContactsEquipmentId((cur) => (cur === device.id ? null : device.id))}
                    />
                    <Text
                      x={-22}
                      y={-5}
                      width={44}
                      align="center"
                      text={`${summary?.total ?? 0}`}
                      fontSize={11}
                      fontStyle="bold"
                      fill="#ffffff"
                      listening={false}
                    />
                  </>
                ) : (
                  <Circle
                    radius={selected ? 11 : 9}
                    fill={markerColor}
                    stroke={selected ? "#2c3e50" : "#ffffff"}
                    strokeWidth={selected ? 2.5 : 1}
                    onClick={() => onSelectDevice(device)}
                    onTap={() => onSelectDevice(device)}
                  />
                )}
                <Text
                  x={-30}
                  y={12}
                  width={60}
                  align="center"
                  text={device.name}
                  fontSize={11}
                  fill="#2c3e50"
                  listening={false}
                />
              </Group>
            );
          })}
          {/* 호버 툴팁 — 감시장비의 일괄 상태(집계)만 간결하게 보여준다. */}
          {hoveredEquipment && hoveredSummary && (() => {
            const hoveredIndex = renderedDevices.findIndex((device) => device.id === hoveredEquipment.id);
            const { x, y } = devicePosition(
              hoveredEquipment,
              Math.max(hoveredIndex, 0),
              pendingPositions[hoveredEquipment.id],
            );
            const lines = [
              hoveredEquipment.name,
              `전체 ${hoveredSummary.total} · ON ${hoveredSummary.on} · OFF ${hoveredSummary.off}`,
              [
                hoveredSummary.warning > 0 ? `WARNING ${hoveredSummary.warning}` : null,
                hoveredSummary.alarm > 0 ? `ALARM ${hoveredSummary.alarm}` : null,
                hoveredSummary.offline > 0 ? `OFFLINE ${hoveredSummary.offline}` : null,
              ].filter(Boolean).join(" · ") || "이상 없음",
              "클릭하면 접점별 상태",
            ];
            const text = lines.join("\n");
            return (
              <Group x={Math.min(x + 18, width - 210)} y={Math.max(y - 24, 10)} listening={false}>
                <Rect width={200} height={78} cornerRadius={6} fill="#111827" opacity={0.92} shadowBlur={6} shadowColor="rgba(0,0,0,0.3)" />
                <Rect x={0} y={0} width={200} height={4} cornerRadius={2} fill={DEVICE_STATUS_COLOR[hoveredSummary.status]} />
                <Text x={12} y={12} width={176} text={text} fontSize={12} lineHeight={1.4} fill="#f9fafb" />
              </Group>
            );
          })()}
        </Layer>
        </Stage>
      </div>

      {/* 클릭 → 접점별 상태 패널. 선택된 감시장비의 자식 접점(센서)을 접점주소/단자/IO/상태로 나열. */}
      {contactsEquipment && contactsSummary && (
        <div className="floor-map__contacts">
          <div className="floor-map__contacts-head">
            <div>
              <strong>{contactsEquipment.name}</strong>
              <span className="floor-map__contacts-sub">
                {contactsEquipment.channelAddress ? `${contactsEquipment.channelAddress} · ` : ""}
                접점 {contactsSummary.total}개
              </span>
            </div>
            <div className="floor-map__contacts-agg">
              <span className="badge badge--on">ON {contactsSummary.on}</span>
              <span className="badge badge--off">OFF {contactsSummary.off}</span>
              {contactsSummary.warning > 0 && <span className="badge badge--warning">WARNING {contactsSummary.warning}</span>}
              {contactsSummary.alarm > 0 && <span className="badge badge--alarm">ALARM {contactsSummary.alarm}</span>}
              {contactsSummary.offline > 0 && <span className="badge badge--offline">OFFLINE {contactsSummary.offline}</span>}
            </div>
            <button type="button" className="floor-map__contacts-close" onClick={() => setContactsEquipmentId(null)}>
              ✕
            </button>
          </div>
          {contactsSensors.length === 0 ? (
            <p className="floor-map__contacts-empty">이 감시장비에 등록된 접점이 없습니다.</p>
          ) : (
            <div className="floor-map__contacts-grid" role="table">
              <div className="floor-map__contacts-row floor-map__contacts-row--head" role="row">
                <span>상태</span>
                <span>접점</span>
                <span>단자</span>
                <span>I/O</span>
                <span>이름</span>
              </div>
              {contactsSensors.map((sensor) => (
                <button
                  key={sensor.id}
                  type="button"
                  role="row"
                  className={`floor-map__contacts-row ${sensor.id === selectedDeviceId ? "active" : ""}`}
                  onClick={() => onSelectDevice(sensor)}
                >
                  <span className="floor-map__contacts-status">
                    <i style={{ background: DEVICE_STATUS_COLOR[sensor.currentStatus] }} aria-hidden="true" />
                    {sensor.currentStatus}
                  </span>
                  <span>{sensor.channelAddress ?? "—"}</span>
                  <span>{sensor.terminalBlock ?? "—"}</span>
                  <span>{sensor.sensorIoType ?? "—"}</span>
                  <span className="floor-map__contacts-name">{sensor.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {monitoringLevel === "sensor" && (
        <div className="floor-map__sensor-grid">
          {visibleSensors.map((sensor) => (
            <button
              key={sensor.id}
              type="button"
              className={`sensor-card ${sensor.id === selectedDeviceId ? "active" : ""}`}
              onClick={() => onSelectDevice(sensor)}
            >
              <span className="sensor-card__icon" aria-hidden="true">
                <i style={{ background: DEVICE_STATUS_COLOR[sensor.currentStatus] }} />
              </span>
              <span className="sensor-card__state">{sensor.currentStatus}</span>
              <strong>{sensorLabel(sensor)}</strong>
              <small>{sensor.sensorIoType ?? "I/O"} · {sensor.deviceType ?? sensor.category}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
