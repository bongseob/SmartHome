import { useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Circle, Group, Image as KonvaImage, Layer, Rect, Stage, Text } from "react-konva";
import type { DeviceStatus } from "@smarthome/contracts";
import type { AreaOverview, DeviceListItem } from "../lib/types";
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

/**
 * 관제 화면 진입 시 기본 배율(2026-07-15 요청) — 도면을 잘라내지 않고 항상 전체가 화면 안에
 * 들어오되, 100%(원본 크기)를 넘겨 확대하지는 않는다. 뷰포트가 도면보다 작으면 축소해서 전부
 * 보여주고(contain), 뷰포트가 도면보다 크면 100%로 중앙에 배치한다(빈 여백은 정상).
 */
function fitMapToViewport(
  viewport: { width: number; height: number },
  map: { width: number; height: number },
): { scale: number; pos: { x: number; y: number } } {
  const containScale = Math.min(viewport.width / map.width, viewport.height / map.height, 1);
  const safeScale = Math.max(MIN_SCALE, containScale);
  return {
    scale: safeScale,
    pos: {
      x: (viewport.width - map.width * safeScale) / 2,
      y: (viewport.height - map.height * safeScale) / 2,
    },
  };
}

/** 접점(자식 센서)을 접점주소 기준으로 안정 정렬한다. */
function setCursor(event: Konva.KonvaEventObject<MouseEvent>, cursor: string): void {
  const container = event.target.getStage()?.container();
  if (container) container.style.cursor = cursor;
}

function sortContacts(sensors: DeviceListItem[]): DeviceListItem[] {
  return [...sensors].sort((a, b) =>
    (a.channelAddress ?? a.name).localeCompare(b.channelAddress ?? b.name, undefined, { numeric: true }),
  );
}

interface DeviceMarkerProps {
  device: DeviceListItem;
  x: number;
  y: number;
  isEquipment: boolean;
  selected: boolean;
  hovered: boolean;
  emphasized: boolean;
  markerColor: string;
  summaryTotal: number | null;
  isAlarmed: boolean;
  editMode: boolean;
  pos: { x: number; y: number };
  scale: number;
  width: number;
  height: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
  onSelectSensor: () => void;
  onToggleEquipment: () => void;
}

/**
 * 기기 마커 1개 — 사용자 지정 이미지(device.imageUrl)가 있으면 실제 사진을 클리핑해 보여주고,
 * 상태(ON/OFF/알람 등)는 이미지에 가려 안 보이지 않도록 테두리 링 색 + 우하단 상태 점으로 이중
 * 표시한다(사진만으로는 상태 변화를 알 수 없다는 요구사항 반영). 이미지가 없으면 기존처럼 단색
 * 마커 그대로 — 회귀 없음. useHtmlImage는 훅이라 .map() 안에서 직접 호출할 수 없어 별도
 * 컴포넌트로 분리했다.
 */
function DeviceMarker({
  device,
  x,
  y,
  isEquipment,
  selected,
  hovered,
  emphasized,
  markerColor,
  summaryTotal,
  isAlarmed,
  editMode,
  pos,
  scale,
  width,
  height,
  onMouseEnter,
  onMouseLeave,
  onDragMove,
  onDragEnd,
  onSelectSensor,
  onToggleEquipment,
}: DeviceMarkerProps): JSX.Element {
  const image = useHtmlImage(apiAssetUrl(device.imageUrl));
  const half = emphasized ? 14 : 12;
  const size = half * 2;
  const radius = selected ? 11 : 9;

  return (
    <Group
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
        onMouseEnter();
      }}
      onMouseLeave={(e) => {
        setCursor(e, "default");
        onMouseLeave();
      }}
      onDragMove={(e) => {
        e.cancelBubble = true;
        onDragMove(e.target.x(), e.target.y());
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        onDragEnd(e.target.x(), e.target.y());
        e.target.getStage()?.batchDraw();
      }}
    >
      {isAlarmed && (
        <Circle
          radius={isEquipment ? 22 : 17}
          stroke="#e11d48"
          strokeWidth={3}
          dash={[4, 3]}
          shadowColor="#e11d48"
          shadowBlur={12}
          listening={false}
        />
      )}
      {/* 가상 기기(device-simulator가 대신 응답 중) — 실기기와 한눈에 구분되도록 보라
          점선 테두리를 덧그린다. 알람 링(빨강)보다 안쪽이라 동시에 표시돼도 겹치지 않는다. */}
      {device.simulated && (
        <Circle radius={isEquipment ? 16 : 13} stroke="#7c3aed" strokeWidth={1.5} dash={[2, 2]} listening={false} />
      )}
      {isEquipment ? (
        <>
          {image && (
            <Group
              listening={false}
              clipFunc={(ctx) => {
                const r = 5;
                ctx.beginPath();
                ctx.moveTo(-half + r, -half);
                ctx.arcTo(half, -half, half, half, r);
                ctx.arcTo(half, half, -half, half, r);
                ctx.arcTo(-half, half, -half, -half, r);
                ctx.arcTo(-half, -half, half, -half, r);
                ctx.closePath();
              }}
            >
              <KonvaImage image={image} x={-half} y={-half} width={size} height={size} />
            </Group>
          )}
          <Rect
            x={-half}
            y={-half}
            width={size}
            height={size}
            cornerRadius={5}
            fill={image ? undefined : markerColor}
            stroke={selected ? "#111827" : hovered ? "#2563eb" : image ? markerColor : "#ffffff"}
            strokeWidth={image ? (emphasized ? 3 : 2.5) : emphasized ? 2.5 : 1.5}
            shadowColor="rgba(15, 23, 42, 0.35)"
            shadowBlur={emphasized ? 9 : 6}
            onClick={() => !editMode && onToggleEquipment()}
            onTap={() => !editMode && onToggleEquipment()}
          />
          {image && (
            <>
              <Circle radius={5} x={half - 3} y={half - 3} fill={markerColor} stroke="#ffffff" strokeWidth={1.5} listening={false} />
              <Rect x={-14} y={-8} width={28} height={16} cornerRadius={8} fill="rgba(17, 24, 39, 0.55)" listening={false} />
            </>
          )}
          <Text
            x={-22}
            y={-5}
            width={44}
            align="center"
            text={`${summaryTotal ?? 0}`}
            fontSize={11}
            fontStyle="bold"
            fill="#ffffff"
            listening={false}
          />
        </>
      ) : (
        <>
          {image && (
            <Group
              listening={false}
              clipFunc={(ctx) => {
                ctx.beginPath();
                ctx.arc(0, 0, radius, 0, Math.PI * 2, false);
                ctx.closePath();
              }}
            >
              <KonvaImage image={image} x={-radius} y={-radius} width={radius * 2} height={radius * 2} />
            </Group>
          )}
          <Circle
            radius={radius}
            fill={image ? undefined : markerColor}
            stroke={image ? markerColor : selected ? "#2c3e50" : "#ffffff"}
            strokeWidth={image ? (selected ? 3 : 2.5) : selected ? 2.5 : 1}
            onClick={onSelectSensor}
            onTap={onSelectSensor}
          />
          {image && (
            <Circle radius={4} x={radius - 2} y={radius - 2} fill={markerColor} stroke="#ffffff" strokeWidth={1} listening={false} />
          )}
        </>
      )}
      <Text x={-30} y={12} width={60} align="center" text={device.name} fontSize={11} fill="#2c3e50" listening={false} />
    </Group>
  );
}

interface FloorMapProps {
  overview: AreaOverview;
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
  /** 미확인 알람이 걸린 기기(접점) id 집합 — 해당 마커를 빨간 링으로 강조한다. */
  alarmedDeviceIds?: Set<string>;
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
  alarmedDeviceIds,
}: FloorMapProps): JSX.Element {
  const width = overview.area.imageWidthPx ?? FALLBACK_WIDTH;
  const height = overview.area.imageHeightPx ?? FALLBACK_HEIGHT;
  const image = useHtmlImage(apiAssetUrl(overview.area.imageUrl));
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [stageSize, setStageSize] = useState({
    width: Math.min(width, 1000),
    height: Math.min(height, 700),
  });
  const [monitoringLevel, setMonitoringLevel] = useState<MonitoringLevel>("equipment");
  // 감시장비 호버 → 일괄 상태 툴팁. 클릭(접점별 패널)과 분리된 상호작용이다.
  const [hoveredEquipmentId, setHoveredEquipmentId] = useState<string | null>(null);
  // 개별 센서 호버 → 상세정보 오버레이(목록 대신 마우스오버로만 노출, 2026-07-15 요청).
  const [hoveredSensorId, setHoveredSensorId] = useState<string | null>(null);
  // 감시장비 클릭 → 접점별 상태 패널 대상.
  const [contactsEquipmentId, setContactsEquipmentId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null);

  // 지역이 바뀌면 호버/접점 선택을 초기화한다(이전 지역의 잔상 방지).
  useEffect(() => {
    setHoveredEquipmentId(null);
    setHoveredSensorId(null);
    setContactsEquipmentId(null);
  }, [overview.area.id]);

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
  }, [overview.area.id, stageSize, width, height]);

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

  // 외부(전체 모니터링)에서 감시장비를 선택하면 접점별 패널을 펼친다. 지역 전환 자체는 호출부
  // (App.tsx)가 이미 그 감시장비가 속한 지역으로 selectedAreaId를 옮긴 뒤 이 컴포넌트를 그 지역의
  // overview로 렌더링하므로, 여기서는 접점 패널만 연다.
  useEffect(() => {
    if (!focusEquipmentId) return;
    const target = equipments.find((device) => device.id === focusEquipmentId);
    if (!target) return; // 아직 해당 지역 overview가 로드되지 않음 → 다음 렌더에서 재시도
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

  // overview.devices가 이미 지역(area) 1개로 스코프돼 있어 추가 필터가 필요 없다.
  const visibleEquipments = equipments;
  const visibleSensors = sensors;

  const contactsEquipment = contactsEquipmentId
    ? equipments.find((device) => device.id === contactsEquipmentId) ?? null
    : null;
  const contactsSensors = contactsEquipment
    ? sortContacts(sensorsByEquipment.get(contactsEquipment.id) ?? [])
    : [];
  const contactsSummary = contactsEquipment
    ? summarizeSensors(contactsEquipment, contactsSensors)
    : null;

  // 감시장비를 드릴다운(접점 패널을 연) 상태에서는 상단 레벨과 무관하게 그 감시장비와
  // 소속 개별 센서만 도면에 배치한다 — 지역 전체 개별 센서(visibleSensors)로 되돌아가지 않는다.
  const renderedDevices = contactsEquipment
    ? [contactsEquipment, ...contactsSensors]
    : monitoringLevel === "equipment"
      ? visibleEquipments
      : visibleSensors;

  const hoveredEquipment = hoveredEquipmentId
    ? equipments.find((device) => device.id === hoveredEquipmentId) ?? null
    : null;
  const hoveredSummary = hoveredEquipment
    ? summarizeSensors(hoveredEquipment, sensorsByEquipment.get(hoveredEquipment.id) ?? [])
    : null;

  const hoveredSensor = hoveredSensorId
    ? sensors.find((device) => device.id === hoveredSensorId) ?? null
    : null;

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

  return (
    <div className="floor-map">
      <div className="floor-map__toolbar">
        <span className="floor-map__area-select">{overview.area.name}</span>
        {contactsEquipment && (
          <button
            type="button"
            className="floor-map__back"
            onClick={() => setContactsEquipmentId(null)}
            title="감시장비 목록으로 돌아갑니다."
          >
            ← 감시장비 목록
          </button>
        )}
        <div className="floor-map__level-toggle">
          <button
            type="button"
            className={monitoringLevel === "equipment" ? "active" : ""}
            onClick={() => {
              setMonitoringLevel("equipment");
              setContactsEquipmentId(null);
            }}
          >
            감시장비
          </button>
          <button
            type="button"
            className={monitoringLevel === "sensor" ? "active" : ""}
            disabled={contactsEquipment !== null}
            title={
              contactsEquipment !== null
                ? "감시장비를 선택한 상태에서는 해당 장비의 센서만 표시합니다. 지역 전체 센서를 보려면 접점 패널을 닫으세요."
                : undefined
            }
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
          {contactsEquipment
            ? `${contactsEquipment.name} 접점 ${contactsSensors.length}개`
            : monitoringLevel === "equipment"
              ? `감시장비 ${visibleEquipments.length}대 / 센서 ${visibleSensors.length}개`
              : `개별 센서 ${visibleSensors.length}개`}
        </span>
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
            // 미확인 알람: 접점 자체 또는 감시장비 하위 접점 중 하나라도 알람이면 강조.
            const isAlarmed = alarmedDeviceIds
              ? isEquipment
                ? alarmedDeviceIds.has(device.id) || childSensors.some((s) => alarmedDeviceIds.has(s.id))
                : alarmedDeviceIds.has(device.id)
              : false;
            return (
              <DeviceMarker
                key={device.id}
                device={device}
                x={x}
                y={y}
                isEquipment={isEquipment}
                selected={selected}
                hovered={hovered}
                emphasized={emphasized}
                markerColor={markerColor}
                summaryTotal={summary?.total ?? null}
                isAlarmed={isAlarmed}
                editMode={editMode}
                pos={pos}
                scale={scale}
                width={width}
                height={height}
                onMouseEnter={() => (isEquipment ? setHoveredEquipmentId(device.id) : setHoveredSensorId(device.id))}
                onMouseLeave={() =>
                  isEquipment
                    ? setHoveredEquipmentId((current) => (current === device.id ? null : current))
                    : setHoveredSensorId((current) => (current === device.id ? null : current))
                }
                onDragMove={(nx, ny) => setDragPreview({ id: device.id, x: nx, y: ny })}
                onDragEnd={(nx, ny) => {
                  setDragPreview(null);
                  onDeviceDragEnd?.(device.id, nx, ny);
                }}
                onSelectSensor={() => onSelectDevice(device)}
                onToggleEquipment={() => setContactsEquipmentId((cur) => (cur === device.id ? null : device.id))}
              />
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

            const TOOLTIP_WIDTH = 200;
            const TOOLTIP_HEIGHT = 78;
            // 호버된 마커의 강조 크기(半 14px) + 여유 간격 — 이보다 좁으면 마커 자체를 덮는다.
            const MARKER_CLEARANCE = 20;
            const CANVAS_MARGIN = 10;

            // 기본은 마커 오른쪽에 띄우고, 오른쪽에 공간이 부족하면 왼쪽으로 뒤집는다.
            // (예전엔 오른쪽 좌표를 캔버스 폭 안으로 clamp만 해서, 우측 여백이 부족하면
            // 툴팁이 마커 쪽으로 밀려와 그대로 덮어버렸다.)
            const fitsRight = x + MARKER_CLEARANCE + TOOLTIP_WIDTH <= width - CANVAS_MARGIN;
            const tooltipX = fitsRight
              ? x + MARKER_CLEARANCE
              : Math.max(x - MARKER_CLEARANCE - TOOLTIP_WIDTH, CANVAS_MARGIN);
            const tooltipY = Math.min(
              Math.max(y - TOOLTIP_HEIGHT / 2, CANVAS_MARGIN),
              height - TOOLTIP_HEIGHT - CANVAS_MARGIN,
            );

            return (
              <Group x={tooltipX} y={tooltipY} listening={false}>
                <Rect width={TOOLTIP_WIDTH} height={TOOLTIP_HEIGHT} cornerRadius={6} fill="#111827" opacity={0.92} shadowBlur={6} shadowColor="rgba(0,0,0,0.3)" />
                <Rect x={0} y={0} width={TOOLTIP_WIDTH} height={4} cornerRadius={2} fill={DEVICE_STATUS_COLOR[hoveredSummary.status]} />
                <Text x={12} y={12} width={TOOLTIP_WIDTH - 24} text={text} fontSize={12} lineHeight={1.4} fill="#f9fafb" />
              </Group>
            );
          })()}
          {/* 개별 센서 호버 툴팁 — 하단 목록 대신 마우스오버 시에만 상세정보를 보여준다. */}
          {hoveredSensor && (() => {
            const hoveredIndex = renderedDevices.findIndex((device) => device.id === hoveredSensor.id);
            const { x, y } = devicePosition(
              hoveredSensor,
              Math.max(hoveredIndex, 0),
              pendingPositions[hoveredSensor.id],
            );
            const lines = [
              sensorLabel(hoveredSensor),
              `상태 ${hoveredSensor.currentStatus}`,
              `${hoveredSensor.sensorIoType ?? "I/O"} · ${hoveredSensor.deviceType ?? hoveredSensor.category}`,
            ];
            const text = lines.join("\n");

            const TOOLTIP_WIDTH = 190;
            const TOOLTIP_HEIGHT = 64;
            const MARKER_CLEARANCE = 16;
            const CANVAS_MARGIN = 10;

            const fitsRight = x + MARKER_CLEARANCE + TOOLTIP_WIDTH <= width - CANVAS_MARGIN;
            const tooltipX = fitsRight
              ? x + MARKER_CLEARANCE
              : Math.max(x - MARKER_CLEARANCE - TOOLTIP_WIDTH, CANVAS_MARGIN);
            const tooltipY = Math.min(
              Math.max(y - TOOLTIP_HEIGHT / 2, CANVAS_MARGIN),
              height - TOOLTIP_HEIGHT - CANVAS_MARGIN,
            );

            return (
              // 옆 센서가 어렴풋이 비치도록 감시장비 툴팁(0.92)보다 낮은 투명도(2026-07-15 요청).
              <Group x={tooltipX} y={tooltipY} listening={false}>
                <Rect width={TOOLTIP_WIDTH} height={TOOLTIP_HEIGHT} cornerRadius={6} fill="#111827" opacity={0.72} shadowBlur={6} shadowColor="rgba(0,0,0,0.3)" />
                <Rect x={0} y={0} width={TOOLTIP_WIDTH} height={4} cornerRadius={2} fill={DEVICE_STATUS_COLOR[hoveredSensor.currentStatus]} />
                <Text x={12} y={12} width={TOOLTIP_WIDTH - 24} text={text} fontSize={12} lineHeight={1.4} fill="#f9fafb" />
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
    </div>
  );
}
