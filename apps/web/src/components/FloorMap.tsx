import { useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Circle, Group, Image as KonvaImage, Layer, Line, Stage, Text } from "react-konva";
import type { Area, DeviceListItem, FloorOverview } from "../lib/types";
import { DEVICE_STATUS_COLOR } from "../lib/status";
import { useHtmlImage } from "../lib/useHtmlImage";

const FALLBACK_WIDTH = 800;
const FALLBACK_HEIGHT = 600;
const MIN_SCALE = 0.3;
const MAX_SCALE = 4;

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
  const image = useHtmlImage(overview.floor.floorMapUrl);
  const stageRef = useRef<Konva.Stage>(null);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
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
        onDragEnd={(e) => setPos({ x: e.target.x(), y: e.target.y() })}
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
          {overview.devices.map((device, index) => {
            const { x, y } =
              dragPreview?.id === device.id
                ? { x: dragPreview.x, y: dragPreview.y }
                : devicePosition(device, index, pendingPositions[device.id]);
            const selected = device.id === selectedDeviceId;
            return (
              // Group 자체를 기기 좌표로 두고 드래그해야 Circle+Text가 함께 움직인다.
              <Group
                key={device.id}
                x={x}
                y={y}
                draggable={editMode}
                onDragMove={(e) => setDragPreview({ id: device.id, x: e.target.x(), y: e.target.y() })}
                onDragEnd={(e) => {
                  setDragPreview(null);
                  onDeviceDragEnd?.(device.id, e.target.x(), e.target.y());
                  // 프로그래밍적 위치 갱신 후 히트 그래프가 갱신되지 않아 다음 드래그가 안 먹는 사례 방지.
                  e.target.getStage()?.batchDraw();
                }}
              >
                <Circle
                  radius={selected ? 11 : 9}
                  fill={DEVICE_STATUS_COLOR[device.currentStatus]}
                  stroke={selected ? "#2c3e50" : "#ffffff"}
                  strokeWidth={selected ? 2.5 : 1}
                  onClick={() => onSelectDevice(device)}
                  onTap={() => onSelectDevice(device)}
                />
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
        </Layer>
      </Stage>
    </div>
  );
}
