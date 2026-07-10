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

function devicePosition(device: DeviceListItem, fallbackIndex: number): { x: number; y: number } {
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
}

export function FloorMap({ overview, selectedDeviceId, onSelectDevice }: FloorMapProps): JSX.Element {
  const width = overview.floor.floorMapWidth ?? FALLBACK_WIDTH;
  const height = overview.floor.floorMapHeight ?? FALLBACK_HEIGHT;
  const image = useHtmlImage(overview.floor.floorMapUrl);
  const stageRef = useRef<Konva.Stage>(null);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });

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
        draggable
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
            const { x, y } = devicePosition(device, index);
            const selected = device.id === selectedDeviceId;
            return (
              <Group key={device.id}>
                <Circle
                  x={x}
                  y={y}
                  radius={selected ? 11 : 9}
                  fill={DEVICE_STATUS_COLOR[device.currentStatus]}
                  stroke={selected ? "#2c3e50" : "#ffffff"}
                  strokeWidth={selected ? 2.5 : 1}
                  onClick={() => onSelectDevice(device)}
                  onTap={() => onSelectDevice(device)}
                />
                <Text
                  x={x - 30}
                  y={y + 12}
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
