import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import {
  ApiError,
  apiAssetUrl,
  assignFloorMapImage,
  deleteImage,
  listFloors,
  listImages,
  updateFloorMapScale,
  uploadImage,
} from "../lib/api";
import type { FloorSummary, ImageRecord } from "../lib/types";
import { useConfirm } from "./ConfirmDialog";

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

interface ImageLibraryProps {
  images: ImageRecord[];
  onCreated: (image: ImageRecord) => void;
  onRemoved: (id: string) => void;
}

function ImageLibrary({ images, onCreated, onRemoved }: ImageLibraryProps): JSX.Element {
  const confirm = useConfirm();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) {
      setError("이미지 파일을 선택하세요.");
      return;
    }
    const imageName = name.trim() || file.name;
    setSubmitting(true);
    setError(null);
    try {
      const { width, height } = await readImageDimensions(file);
      const created = await uploadImage(file, { name: imageName, widthPx: width, heightPx: height });
      onCreated(created);
      setName("");
      setFile(null);
      e.currentTarget.reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "이미지 등록에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (image: ImageRecord) => {
    confirm(`'${image.name}' 이미지를 삭제할까요? 이미 매핑된 배경은 별도 도면 기록으로 유지됩니다.`, { danger: true }).then(
      (ok) => {
        if (!ok) return;
        deleteImage(image.id)
          .then(() => onRemoved(image.id))
          .catch((err: unknown) => {
            setError(err instanceof ApiError ? err.detail : "이미지 삭제에 실패했습니다.");
          });
      },
    );
  };

  return (
    <section className="floor-map-admin__section">
      <h3>이미지 등록</h3>
      <p className="floor-map-admin__note">
        이미지는 이미지 라이브러리에 기본 정보만 저장됩니다. 실제 지역 배경 적용은 아래 매핑에서 별도로 수행합니다.
      </p>
      <form className="floor-map-admin__upload" onSubmit={handleSubmit}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이미지 이름" />
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} />
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? "등록 중…" : "이미지 등록"}
        </button>
      </form>
      {error && <p className="error-text">{error}</p>}

      <table className="floor-map-admin__table">
        <thead>
          <tr>
            <th>이미지</th>
            <th>이름</th>
            <th>크기</th>
            <th>등록일</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          {images.map((image) => (
            <tr key={image.id}>
              <td>
                <img src={apiAssetUrl(image.imageUrl) ?? ""} alt={image.name} className="floor-map-admin__thumb" />
              </td>
              <td>{image.name}</td>
              <td>{image.widthPx && image.heightPx ? `${image.widthPx}×${image.heightPx}px` : "-"}</td>
              <td>{new Date(image.uploadedAt).toLocaleString()}</td>
              <td>
                <button type="button" onClick={() => handleDelete(image)}>
                  삭제
                </button>
              </td>
            </tr>
          ))}
          {images.length === 0 && (
            <tr>
              <td colSpan={5} className="floor-map-admin__empty">
                등록된 이미지가 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

interface FloorRowProps {
  floor: FloorSummary;
  images: ImageRecord[];
  onUpdated: (floor: FloorSummary) => void;
}

function FloorRow({ floor, images, onUpdated }: FloorRowProps): JSX.Element {
  const [scaleInput, setScaleInput] = useState(floor.floorMapScale ?? "0.05");
  const [selectedImageId, setSelectedImageId] = useState("");
  const [mapping, setMapping] = useState(false);
  const [savingScale, setSavingScale] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleMapImage = () => {
    if (!selectedImageId) {
      setError("매핑할 이미지를 선택하세요.");
      return;
    }
    const scaleMPerPx = Number(scaleInput);
    if (!Number.isFinite(scaleMPerPx) || scaleMPerPx <= 0) {
      setError("스케일(m/px)을 올바르게 입력하세요.");
      return;
    }
    setMapping(true);
    setError(null);
    assignFloorMapImage(floor.id, selectedImageId, scaleMPerPx)
      .then(onUpdated)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.detail : "이미지 매핑에 실패했습니다.");
      })
      .finally(() => setMapping(false));
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
      <td>{floor.floorMapWidth && floor.floorMapHeight ? `${floor.floorMapWidth}×${floor.floorMapHeight}px` : "-"}</td>
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
        <select value={selectedImageId} onChange={(e) => setSelectedImageId(e.target.value)}>
          <option value="">등록 이미지 선택</option>
          {images.map((image) => (
            <option key={image.id} value={image.id}>
              {image.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={handleMapImage} disabled={mapping || images.length === 0}>
          {mapping ? "매핑 중…" : "배경 매핑"}
        </button>
        {error && <p className="error-text">{error}</p>}
      </td>
    </tr>
  );
}

export function FloorMapAdmin(): JSX.Element {
  const [floors, setFloors] = useState<FloorSummary[]>([]);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = () => {
    Promise.all([listFloors(), listImages()])
      .then(([floorResult, imageResult]) => {
        setFloors(floorResult);
        setImages(imageResult);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof ApiError ? err.detail : "도면 관리 정보를 불러오지 못했습니다.");
      });
  };

  useEffect(reload, []);

  return (
    <div className="floor-map-admin">
      <h2>도면 / 이미지 관리</h2>

      {loadError && <p className="error-text">{loadError}</p>}

      <ImageLibrary
        images={images}
        onCreated={(image) => setImages((prev) => [image, ...prev])}
        onRemoved={(id) => setImages((prev) => prev.filter((image) => image.id !== id))}
      />

      <section className="floor-map-admin__section">
        <h3>지역 배경 매핑</h3>
        <p className="floor-map-admin__note">
          등록된 이미지를 선택해 층 배경으로 매핑합니다. 이 과정에서 관제 화면용 도면 기록이 생성되고 해당 층에 연결됩니다.
        </p>
        <table className="floor-map-admin__table">
          <thead>
            <tr>
              <th>층</th>
              <th>현재 배경</th>
              <th>크기</th>
              <th>스케일(m/px)</th>
              <th>이미지 매핑</th>
            </tr>
          </thead>
          <tbody>
            {floors.map((f) => (
              <FloorRow
                key={f.id}
                floor={f}
                images={images}
                onUpdated={(updated) => setFloors((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
              />
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
