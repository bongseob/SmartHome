import { useMemo, useRef, useState } from "react";
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

interface FloorMapProps {
  overview: FloorOverview;
  selectedDeviceId: string | null;
  onSelectDevice: (device: DeviceListItem) => void;
  /** 편집 모드: 기기 마커를 드래그로 옮길 수 있다(ui-ux-design.md §4.1-mode). 기본 false(실행 모드). */
  editMode?: boolean;
  /** 저장 전 임시 위치(드래그했지만 아직 저장하지 않은 좌표) — deviceId별 override. */
  pendingPositions?: Record<string, { x: number; y: number }>;
  onDeviceDragEnd?: (deviceId: string, x: number, y: number) => void;
}

export function FloorMap({
  overview,
  selectedDeviceId,
  onSelectDevice,
  editMode = false,
  pendingPositions = {},
  onDeviceDragEnd,
}: FloorMapProps): JSX.Element {
  const width = overview.floor.floorMapWidth ?? FALLBACK_WIDTH;
  const height = overview.floor.floorMapHeight ?? FALLBACK_HEIGHT;
  const image = useHtmlImage(apiAssetUrl(overview.floor.floorMapUrl));
  const stageRef = useRef<Konva.Stage>(null);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [monitoringLevel, setMonitoringLevel] = useState<MonitoringLevel>("equipment");
  // 드래그 중인 기기의 실시간 위치. 실시간 이벤트(WS) 등으로 드래그 도중 부모가 리렌더되면
  // devicePosition()이 아직 커밋되지 않은 device.posX/posY(옛 값)로 되돌아가 Konva의 드래그 중
  // 내부 위치와 충돌한다 — onDragMove로 이 state를 계속 갱신해 어떤 리렌더가 끼어들어도
  // 항상 "드래그가 지금 있는 자리"를 좌표로 넘기게 한다.
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null);

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

  const selectedEquipment =
    monitoringLevel === "equipment"
      ? equipments.find((device) => device.id === selectedDeviceId) ?? null
      : null;
  const selectedEquipmentSensors = selectedEquipment ? sensorsByEquipment.get(selectedEquipment.id) ?? [] : [];
  const selectedEquipmentSummary = selectedEquipment
    ? summarizeSensors(selectedEquipment, selectedEquipmentSensors)
    : null;
  const renderedDevices = monitoringLevel === "equipment" ? equipments : sensors;

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
            setScale(1);
            setPos({ x: 0, y: 0 });
          }}
        >
          초기화
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <span className="floor-map__level-summary">
          {monitoringLevel === "equipment"
            ? `감시장비 ${equipments.length}대 / 센서 ${sensors.length}개`
            : `개별 센서 ${sensors.length}개`}
        </span>
      </div>
      <Stage
        ref={stageRef}
        width={Math.min(width, 1000)}
        height={Math.min(height, 700)}
        scaleX={scale}
        scaleY={scale}
        x={pos.x}
        y={pos.y}
        // 편집 모드에서는 캔버스 팬과 마커 드래그가 같은 제스처를 두고 충돌한다(둘 다 draggable이면
        // Stage가 드래그를 가로채 마커 대신 도면 전체가 팬됨) — 편집 모드에서는 팬을 비활성화한다.
        draggable={!editMode}
        onWheel={handleWheel}
        onDragEnd={(e) => {
          // Konva 이벤트는 버블링된다 — 기기 Group의 dragend가 Stage까지 올라와 이 핸들러를
          // 다시 태울 수 있다. 그때 e.target은 Stage가 아니라 그 Group이라 좌표가 기기 위치가
          // 되어버려, 드롭 순간 도면이 그 기기 위치로 튀는 버그가 났다. Stage 자신의 드래그일
          // 때만 처리한다.
          if (e.target !== e.target.getStage()) return;
          setPos({ x: e.target.x(), y: e.target.y() });
        }}
      >
        <Layer listening={false}>
          {image && <KonvaImage image={image} width={width} height={height} opacity={0.9} />}
        </Layer>
        <Layer>
          {areasWithPoints.map(({ area, points }) => (
            <Line
              key={area.id}
              points={points}
              closed
              fill="rgba(52, 152, 219, 0.12)"
              stroke="#3498db"
              strokeWidth={1.5}
            />
          ))}
          {areasWithPoints.map(({ area, points }) => (
            <Text
              key={`${area.id}-label`}
              x={points[0]}
              y={(points[1] ?? 0) - 18}
              text={area.name}
              fontSize={13}
              fill="#2c3e50"
            />
          ))}
        </Layer>
        <Layer>
          {renderedDevices.map((device, index) => {
            const { x, y } =
              dragPreview?.id === device.id
                ? { x: dragPreview.x, y: dragPreview.y }
                : devicePosition(device, index, pendingPositions[device.id]);
            const selected = device.id === selectedDeviceId;
            const childSensors = sensorsByEquipment.get(device.id) ?? [];
            const summary = device.deviceRole === "MONITORING_EQUIPMENT"
              ? summarizeSensors(device, childSensors)
              : null;
            const markerColor = summary ? DEVICE_STATUS_COLOR[summary.status] : DEVICE_STATUS_COLOR[device.currentStatus];
            return (
              // Group 자체를 기기 좌표로 두고 드래그해야 Circle+Text가 함께 움직인다.
              <Group
                key={device.id}
                x={x}
                y={y}
                draggable={editMode}
                dragBoundFunc={(absolutePos) => {
                  // dragBoundFunc는 Stage 기준 절대좌표를 받는다 — 도면(Layer) 좌표로 변환해
                  // [margin, width-margin] 범위로 클램프한 뒤 다시 절대좌표로 돌려준다.
                  const localX = (absolutePos.x - pos.x) / scale;
                  const localY = (absolutePos.y - pos.y) / scale;
                  const clampedX = Math.min(
                    Math.max(localX, MARKER_EDGE_MARGIN),
                    width - MARKER_EDGE_MARGIN,
                  );
                  const clampedY = Math.min(
                    Math.max(localY, MARKER_EDGE_MARGIN),
                    height - MARKER_EDGE_MARGIN,
                  );
                  return {
                    x: clampedX * scale + pos.x,
                    y: clampedY * scale + pos.y,
                  };
                }}
                onDragMove={(e) => {
                  e.cancelBubble = true; // Stage로 버블링되면 팬 핸들러가 오작동한다(아래 주석 참조)
                  setDragPreview({ id: device.id, x: e.target.x(), y: e.target.y() });
                }}
                onDragEnd={(e) => {
                  e.cancelBubble = true;
                  setDragPreview(null);
                  onDeviceDragEnd?.(device.id, e.target.x(), e.target.y());
                  // 프로그래밍적 위치 갱신 후 히트 그래프가 갱신되지 않아 다음 드래그가 안 먹는 사례 방지.
                  e.target.getStage()?.batchDraw();
                }}
              >
                {device.deviceRole === "MONITORING_EQUIPMENT" ? (
                  <>
                    <Rect
                      x={selected ? -14 : -12}
                      y={selected ? -14 : -12}
                      width={selected ? 28 : 24}
                      height={selected ? 28 : 24}
                      cornerRadius={5}
                      fill={markerColor}
                      stroke={selected ? "#111827" : "#ffffff"}
                      strokeWidth={selected ? 2.5 : 1.5}
                      shadowColor="rgba(15, 23, 42, 0.35)"
                      shadowBlur={6}
                      onClick={() => onSelectDevice(device)}
                      onTap={() => onSelectDevice(device)}
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
          {selectedEquipment && selectedEquipmentSummary && (() => {
            const selectedIndex = renderedDevices.findIndex((device) => device.id === selectedEquipment.id);
            const { x, y } = devicePosition(
              selectedEquipment,
              Math.max(selectedIndex, 0),
              pendingPositions[selectedEquipment.id],
            );
            const previewRows = selectedEquipmentSensors
              .slice(0, 12)
              .map((sensor) => `${sensor.channelAddress ?? "--"}  ${sensor.name}  ${sensor.currentStatus}`)
              .join("\n");
            const text = [
              selectedEquipment.name,
              `전체 ${selectedEquipmentSummary.total} / ON ${selectedEquipmentSummary.on} / OFF ${selectedEquipmentSummary.off}`,
              selectedEquipmentSummary.alarm > 0 ? `ALARM ${selectedEquipmentSummary.alarm}` : null,
              previewRows,
              selectedEquipmentSensors.length > 12 ? `외 ${selectedEquipmentSensors.length - 12}개` : null,
            ].filter(Boolean).join("\n");
            return (
              <Group x={Math.min(x + 20, width - 260)} y={Math.max(y - 28, 12)} listening={false}>
                <Rect width={250} height={88 + Math.min(selectedEquipmentSensors.length, 12) * 17} fill="#f0ffd8" stroke="#6b7280" strokeWidth={1.5} shadowBlur={5} shadowColor="rgba(0,0,0,0.18)" />
                <Text x={10} y={9} width={230} text={text} fontSize={12} lineHeight={1.35} fill="#1f2937" />
              </Group>
            );
          })()}
        </Layer>
      </Stage>
      {monitoringLevel === "sensor" && (
        <div className="floor-map__sensor-grid">
          {sensors.map((sensor) => (
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
