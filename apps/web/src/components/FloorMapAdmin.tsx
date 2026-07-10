import { useEffect, useRef, useState } from "react";
import { ApiError, apiAssetUrl, listFloors, updateFloorMapScale, uploadFloorMap } from "../lib/api";
import type { FloorSummary } from "../lib/types";

function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 읽을 수 없습니다."));
    };
    img.src = url;
  });
}

interface FloorRowProps {
  floor: FloorSummary;
  onUpdated: (floor: FloorSummary) => void;
}

function FloorRow({ floor, onUpdated }: FloorRowProps): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scaleInput, setScaleInput] = useState(floor.floorMapScale ?? "0.05");
  const [uploading, setUploading] = useState(false);
  const [savingScale, setSavingScale] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const { width, height } = await readImageDimensions(file);
      const scaleMPerPx = Number(scaleInput);
      if (!Number.isFinite(scaleMPerPx) || scaleMPerPx <= 0) {
        throw new Error("스케일(m/px)을 올바르게 입력하세요.");
      }
      const updated = await uploadFloorMap(floor.id, file, { widthPx: width, heightPx: height, scaleMPerPx });
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "업로드에 실패했습니다.");
    } finally {
      setUploading(false);
    }
  };

  const handleSaveScale = () => {
    if (!floor.floorMapId) return;
    const scaleMPerPx = Number(scaleInput);
    if (!Number.isFinite(scaleMPerPx) || scaleMPerPx <= 0) {
      setError("스케일(m/px)을 올바르게 입력하세요.");
      return;
    }
    setSavingScale(true);
    setError(null);
    updateFloorMapScale(floor.floorMapId, scaleMPerPx)
      .then(() => onUpdated({ ...floor, floorMapScale: String(scaleMPerPx) }))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.detail : "스케일 저장에 실패했습니다.");
      })
      .finally(() => setSavingScale(false));
  };

  const assetUrl = apiAssetUrl(floor.floorMapUrl);

  return (
    <tr>
      <td>
        {floor.siteName} · {floor.buildingName} · {floor.name}
      </td>
      <td>
        {assetUrl ? (
          <img src={assetUrl} alt={floor.name} className="floor-map-admin__thumb" />
        ) : (
          <span className="floor-map-admin__empty">없음</span>
        )}
      </td>
      <td>
        {floor.floorMapWidth && floor.floorMapHeight ? `${floor.floorMapWidth}×${floor.floorMapHeight}px` : "-"}
      </td>
      <td>
        <input
          className="floor-map-admin__scale-input"
          value={scaleInput}
          onChange={(e) => setScaleInput(e.target.value)}
          placeholder="m/px"
        />
        {floor.floorMapId && (
          <button type="button" onClick={handleSaveScale} disabled={savingScale}>
            {savingScale ? "저장 중…" : "스케일 저장"}
          </button>
        )}
      </td>
      <td>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          onChange={handleFileChange}
          disabled={uploading}
        />
        {uploading && <span> 업로드 중…</span>}
        {error && <p className="error-text">{error}</p>}
      </td>
    </tr>
  );
}

export function FloorMapAdmin(): JSX.Element {
  const [floors, setFloors] = useState<FloorSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = () => {
    listFloors()
      .then((result) => {
        setFloors(result);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof ApiError ? err.detail : "층 목록을 불러오지 못했습니다.");
      });
  };

  useEffect(reload, []);

  return (
    <div className="floor-map-admin">
      <h2>도면 관리</h2>
      <p className="floor-map-admin__note">
        평면도 이미지는 로컬 파일시스템에 저장됩니다. 업로드하면 해당 층의 기존 도면을 대체합니다.
      </p>

      {loadError && <p className="error-text">{loadError}</p>}

      <table className="floor-map-admin__table">
        <thead>
          <tr>
            <th>층</th>
            <th>미리보기</th>
            <th>크기</th>
            <th>스케일(m/px)</th>
            <th>업로드</th>
          </tr>
        </thead>
        <tbody>
          {floors.map((f) => (
            <FloorRow
              key={f.id}
              floor={f}
              onUpdated={(updated) => setFloors((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
