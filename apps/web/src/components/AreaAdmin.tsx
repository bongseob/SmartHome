import { useEffect, useState } from "react";
import type Konva from "konva";
import { Circle, Image as KonvaImage, Layer, Line, Stage, Text } from "react-konva";
import {
  ApiError,
  apiAssetUrl,
  createArea,
  deleteArea,
  getFloorOverview,
  listFloors,
  updateArea,
} from "../lib/api";
import type { Area, FloorOverview, FloorSummary } from "../lib/types";
import { useHtmlImage } from "../lib/useHtmlImage";
import { useConfirm } from "./ConfirmDialog";

const FALLBACK_WIDTH = 800;
const FALLBACK_HEIGHT = 600;

function polygonPoints(polygon: unknown): number[] | null {
  if (!Array.isArray(polygon)) return null;
  const points: number[] = [];
  for (const vertex of polygon) {
    if (!Array.isArray(vertex) || vertex.length < 2) return null;
    const [x, y] = vertex;
    if (typeof x !== "number" || typeof y !== "number") return null;
    points.push(x, y);
  }
  return points.length >= 6 ? points : null;
}

export function AreaAdmin(): JSX.Element {
  const confirm = useConfirm();
  const [floors, setFloors] = useState<FloorSummary[]>([]);
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [overview, setOverview] = useState<FloorOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 드로잉 상태 — drawTargetAreaId가 null이면 새 지역 생성, 있으면 해당 지역의 polygon 다시 그리기
  const [drawing, setDrawing] = useState(false);
  const [drawTargetAreaId, setDrawTargetAreaId] = useState<string | null>(null);
  const [drawPoints, setDrawPoints] = useState<number[][]>([]);
  const [pendingName, setPendingName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const width = overview?.floor.floorMapWidth ?? FALLBACK_WIDTH;
  const height = overview?.floor.floorMapHeight ?? FALLBACK_HEIGHT;
  const image = useHtmlImage(apiAssetUrl(overview?.floor.floorMapUrl ?? null));

  useEffect(() => {
    listFloors()
      .then((result) => {
        setFloors(result);
        setSelectedFloorId((current) => current ?? result[0]?.id ?? null);
      })
      .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.detail : "층 목록을 불러오지 못했습니다."));
  }, []);

  const reloadOverview = (floorId: string) => {
    getFloorOverview(floorId)
      .then((result) => {
        setOverview(result);
        setLoadError(null);
      })
      .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.detail : "층 정보를 불러오지 못했습니다."));
  };

  useEffect(() => {
    if (selectedFloorId) reloadOverview(selectedFloorId);
  }, [selectedFloorId]);

  const startCreate = () => {
    setDrawing(true);
    setDrawTargetAreaId(null);
    setDrawPoints([]);
    setPendingName("");
    setError(null);
  };

  const startRedraw = (area: Area) => {
    setDrawing(true);
    setDrawTargetAreaId(area.id);
    setDrawPoints([]);
    setPendingName(area.name);
    setError(null);
  };

  const cancelDrawing = () => {
    setDrawing(false);
    setDrawTargetAreaId(null);
    setDrawPoints([]);
    setPendingName("");
    setError(null);
  };

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!drawing) return;
    if (e.target !== e.target.getStage()) return;
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    setDrawPoints((prev) => [...prev, [pointer.x, pointer.y]]);
  };

  const handleUndoPoint = () => {
    setDrawPoints((prev) => prev.slice(0, -1));
  };

  const handleSave = () => {
    if (drawPoints.length < 3) {
      setError("최소 3개 점이 필요합니다.");
      return;
    }
    if (!selectedFloorId) return;

    if (drawTargetAreaId) {
      setSaving(true);
      setError(null);
      updateArea(drawTargetAreaId, { polygon: drawPoints })
        .then(() => {
          reloadOverview(selectedFloorId);
          cancelDrawing();
        })
        .catch((err: unknown) => setError(err instanceof ApiError ? err.detail : "저장에 실패했습니다."))
        .finally(() => setSaving(false));
      return;
    }

    if (!pendingName.trim()) {
      setError("지역 이름을 입력하세요.");
      return;
    }
    setSaving(true);
    setError(null);
    createArea(selectedFloorId, { name: pendingName.trim(), polygon: drawPoints })
      .then(() => {
        reloadOverview(selectedFloorId);
        cancelDrawing();
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.detail : "저장에 실패했습니다."))
      .finally(() => setSaving(false));
  };

  const handleRename = (area: Area, name: string) => {
    if (!selectedFloorId) return;
    if (!name.trim()) return;
    updateArea(area.id, { name: name.trim() })
      .then(() => reloadOverview(selectedFloorId))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.detail : "이름 저장에 실패했습니다."));
  };

  const handleDelete = (area: Area) => {
    if (!selectedFloorId) return;
    confirm(`'${area.name}' 지역을 삭제할까요? 배정된 기기는 area 없음 상태가 됩니다.`, { danger: true }).then((ok) => {
      if (!ok) return;
      deleteArea(area.id)
        .then(() => reloadOverview(selectedFloorId))
        .catch((err: unknown) => setError(err instanceof ApiError ? err.detail : "삭제에 실패했습니다."));
    });
  };

  return (
    <div className="area-admin">
      <h2>지역(Area) 관리</h2>
      <p className="area-admin__note">
        도면 위를 클릭해 다각형 점을 찍고(최소 3점) 저장하면 새 지역이 생성됩니다. 기존 지역은 "다시
        그리기"로 polygon을 새로 그릴 수 있습니다.
      </p>

      <label className="area-admin__floor-select">
        층{" "}
        <select value={selectedFloorId ?? ""} onChange={(e) => setSelectedFloorId(e.target.value)}>
          {floors.map((f) => (
            <option key={f.id} value={f.id}>
              {f.siteName} · {f.buildingName} · {f.name}
            </option>
          ))}
        </select>
      </label>

      {loadError && <p className="error-text">{loadError}</p>}

      <div className="area-admin__body">
        <div className="area-admin__canvas">
          <div className="area-admin__toolbar">
            {!drawing ? (
              <button type="button" className="primary" onClick={startCreate}>
                + 새 지역 추가
              </button>
            ) : (
              <>
                <span>{drawTargetAreaId ? "polygon 다시 그리기" : "새 지역"} — 점 {drawPoints.length}개</span>
                <button type="button" onClick={handleUndoPoint} disabled={drawPoints.length === 0}>
                  마지막 점 취소
                </button>
                {!drawTargetAreaId && (
                  <input
                    value={pendingName}
                    onChange={(e) => setPendingName(e.target.value)}
                    placeholder="지역 이름"
                  />
                )}
                <button type="button" className="primary" onClick={handleSave} disabled={saving}>
                  {saving ? "저장 중…" : "완료"}
                </button>
                <button type="button" onClick={cancelDrawing} disabled={saving}>
                  취소
                </button>
              </>
            )}
          </div>
          {error && <p className="error-text">{error}</p>}

          {overview && (
            <Stage
              width={Math.min(width, 900)}
              height={Math.min(height, 650)}
              onClick={handleStageClick}
            >
              <Layer listening={false}>
                {image && <KonvaImage image={image} width={width} height={height} opacity={0.9} />}
              </Layer>
              <Layer listening={false}>
                {overview.areas
                  .filter((a) => a.id !== drawTargetAreaId)
                  .map((area) => {
                    const points = polygonPoints(area.polygon);
                    if (!points) return null;
                    return (
                      <Line
                        key={area.id}
                        points={points}
                        closed
                        fill="rgba(52, 152, 219, 0.12)"
                        stroke="#3498db"
                        strokeWidth={1.5}
                      />
                    );
                  })}
                {overview.areas
                  .filter((a) => a.id !== drawTargetAreaId)
                  .map((area) => {
                    const points = polygonPoints(area.polygon);
                    if (!points) return null;
                    return (
                      <Text key={`${area.id}-label`} x={points[0]} y={(points[1] ?? 0) - 18} text={area.name} fontSize={13} fill="#2c3e50" />
                    );
                  })}
              </Layer>
              <Layer>
                {drawPoints.length >= 2 && (
                  <Line points={drawPoints.flat()} stroke="#e67e22" strokeWidth={2} closed={drawPoints.length >= 3} fill="rgba(230,126,34,0.15)" />
                )}
                {drawPoints.map((p, i) => (
                  <Circle
                    key={i}
                    x={p[0]}
                    y={p[1]}
                    radius={6.5}
                    fill="#e67e22"
                    stroke="#ffffff"
                    strokeWidth={1.5}
                    draggable={true}
                    onDragMove={(e) => {
                      e.cancelBubble = true;
                      const nextPos = [e.target.x(), e.target.y()];
                      setDrawPoints((prev) => {
                        const next = [...prev];
                        next[i] = nextPos;
                        return next;
                      });
                    }}
                    onDragEnd={(e) => {
                      e.cancelBubble = true;
                      e.target.getStage()?.batchDraw();
                    }}
                    onMouseEnter={(e) => {
                      const container = e.target.getStage()?.container();
                      if (container) container.style.cursor = "move";
                    }}
                    onMouseLeave={(e) => {
                      const container = e.target.getStage()?.container();
                      if (container) container.style.cursor = "default";
                    }}
                  />
                ))}
              </Layer>
            </Stage>
          )}
        </div>

        <table className="area-admin__table">
          <thead>
            <tr>
              <th>이름</th>
              <th>slug</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(overview?.areas ?? []).map((area) => (
              <AreaRow
                key={area.id}
                area={area}
                onRename={(name) => handleRename(area, name)}
                onRedraw={() => startRedraw(area)}
                onDelete={() => handleDelete(area)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface AreaRowProps {
  area: Area;
  onRename: (name: string) => void;
  onRedraw: () => void;
  onDelete: () => void;
}

function AreaRow({ area, onRename, onRedraw, onDelete }: AreaRowProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(area.name);

  return (
    <tr>
      <td>
        {editing ? (
          <input value={value} onChange={(e) => setValue(e.target.value)} />
        ) : (
          area.name
        )}
      </td>
      <td className="area-admin__slug">{area.slug}</td>
      <td>
        {editing ? (
          <>
            <button
              type="button"
              className="primary"
              onClick={() => {
                onRename(value);
                setEditing(false);
              }}
            >
              저장
            </button>
            <button
              type="button"
              onClick={() => {
                setValue(area.name);
                setEditing(false);
              }}
            >
              취소
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setEditing(true)}>
              이름 수정
            </button>
            <button type="button" onClick={onRedraw}>
              다시 그리기
            </button>
            <button type="button" onClick={onDelete}>
              삭제
            </button>
          </>
        )}
      </td>
    </tr>
  );
}
