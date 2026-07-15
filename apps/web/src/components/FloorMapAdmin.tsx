import { useEffect, useState, type FormEvent } from "react";
import { ApiError, apiAssetUrl, createArea, deleteArea, listAreas, listFloors, listImages, updateArea } from "../lib/api";
import type { AreaSummary, FloorSummary, ImageRecord } from "../lib/types";
import { useConfirm } from "./ConfirmDialog";

interface NewAreaFormProps {
  floors: FloorSummary[];
  onCreated: () => void;
}

/** 지역 추가 — 층은 콤보박스(기존 층 선택 또는 새 이름 입력)로 받는다(2026-07-15 합의).
 *  floor는 사용자가 직접 관리하는 대상이 아니라, 지역 생성 시 find-or-create되는 태그다. */
function NewAreaForm({ floors, onCreated }: NewAreaFormProps): JSX.Element {
  const [name, setName] = useState("");
  const [floorId, setFloorId] = useState("");
  const [newFloorName, setNewFloorName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("지역 이름을 입력하세요.");
      return;
    }
    if (!floorId && !newFloorName.trim()) {
      setError("층을 선택하거나 새 층 이름을 입력하세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    createArea({
      name: name.trim(),
      ...(floorId ? { floorId } : { floorName: newFloorName.trim() }),
    })
      .then(() => {
        onCreated();
        setName("");
        setNewFloorName("");
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.detail : "지역 생성에 실패했습니다."))
      .finally(() => setSubmitting(false));
  };

  return (
    <form className="floor-map-admin__upload" onSubmit={handleSubmit}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="새 지역 이름 (예: 1층 사무실)" />
      <select value={floorId} onChange={(e) => setFloorId(e.target.value)}>
        <option value="">+ 새 층 태그 입력</option>
        {floors.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      {!floorId && (
        <input
          value={newFloorName}
          onChange={(e) => setNewFloorName(e.target.value)}
          placeholder="새 층 이름 (예: 1층)"
        />
      )}
      <button type="submit" className="primary" disabled={submitting}>
        {submitting ? "생성 중…" : "+ 새 지역 추가"}
      </button>
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}

interface AreaRowProps {
  area: AreaSummary;
  images: ImageRecord[];
  onUpdated: (area: AreaSummary) => void;
  onDeleted: (areaId: string) => void;
}

function AreaRow({ area, images, onUpdated, onDeleted }: AreaRowProps): JSX.Element {
  const confirm = useConfirm();
  const [selectedImageId, setSelectedImageId] = useState("");
  const [mapping, setMapping] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(area.name);
  const [savingName, setSavingName] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleMapImage = () => {
    if (!selectedImageId) {
      setError("매핑할 이미지를 선택하세요.");
      return;
    }
    setMapping(true);
    setError(null);
    updateArea(area.id, { imageId: selectedImageId })
      .then(onUpdated)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.detail : "이미지 매핑에 실패했습니다."))
      .finally(() => setMapping(false));
  };

  const handleClearImage = () => {
    setMapping(true);
    setError(null);
    updateArea(area.id, { imageId: null })
      .then(onUpdated)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.detail : "배경 해제에 실패했습니다."))
      .finally(() => setMapping(false));
  };

  const handleSaveName = () => {
    if (!nameInput.trim()) return;
    setSavingName(true);
    setError(null);
    updateArea(area.id, { name: nameInput.trim() })
      .then((updated) => {
        onUpdated(updated);
        setEditingName(false);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.detail : "이름 저장에 실패했습니다."))
      .finally(() => setSavingName(false));
  };

  const handleDelete = () => {
    confirm(`'${area.name}' 지역을 삭제할까요? 배정된 기기는 지역 없음 상태가 됩니다.`, { danger: true }).then((ok) => {
      if (!ok) return;
      setDeleting(true);
      setError(null);
      deleteArea(area.id)
        .then(() => onDeleted(area.id))
        .catch((err: unknown) => {
          setError(err instanceof ApiError ? err.detail : "삭제에 실패했습니다.");
          setDeleting(false);
        });
    });
  };

  const assetUrl = apiAssetUrl(area.imageUrl);

  return (
    <tr>
      <td>
        {editingName ? (
          <>
            <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
            <button type="button" className="primary" onClick={handleSaveName} disabled={savingName}>
              {savingName ? "저장 중…" : "저장"}
            </button>
            <button
              type="button"
              onClick={() => {
                setNameInput(area.name);
                setEditingName(false);
              }}
            >
              취소
            </button>
          </>
        ) : (
          <>
            {area.name}{" "}
            <button type="button" onClick={() => setEditingName(true)}>
              이름 수정
            </button>
            <button type="button" onClick={handleDelete} disabled={deleting}>
              {deleting ? "삭제 중…" : "삭제"}
            </button>
          </>
        )}
      </td>
      <td>{area.floorName}</td>
      <td>
        {assetUrl ? (
          <img src={assetUrl} alt={area.name} className="floor-map-admin__thumb" />
        ) : (
          <span className="floor-map-admin__empty">없음</span>
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
        {area.imageId && (
          <button type="button" onClick={handleClearImage} disabled={mapping}>
            배경 해제
          </button>
        )}
        {error && <p className="error-text">{error}</p>}
      </td>
    </tr>
  );
}

export function FloorMapAdmin(): JSX.Element {
  const [floors, setFloors] = useState<FloorSummary[]>([]);
  const [areas, setAreas] = useState<AreaSummary[]>([]);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = () => {
    Promise.all([listFloors(), listAreas(), listImages()])
      .then(([floorResult, areaResult, imageResult]) => {
        setFloors(floorResult);
        setAreas(areaResult);
        setImages(imageResult);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof ApiError ? err.detail : "지역 관리 정보를 불러오지 못했습니다.");
      });
  };

  useEffect(reload, []);

  return (
    <div className="floor-map-admin">
      <h2>지역 관리</h2>

      {loadError && <p className="error-text">{loadError}</p>}

      <section className="floor-map-admin__section">
        <h3>지역 목록 / 배경 매핑</h3>
        <p className="floor-map-admin__note">
          지역을 추가·삭제·이름수정하고, 등록된 이미지를 선택해 배경으로 매핑합니다. 배경 이미지가 구역
          구분(화장실·복도 등)을 시각적으로 보여주므로 별도 구역 설정은 두지 않습니다. 층은 지역에 붙는
          태그일 뿐이라 별도로 관리하지 않고, 지역을 만들 때 선택하거나 새로 입력합니다. 이미지 등록/수정은
          "이미지 관리" 화면에서 합니다.
        </p>
        <NewAreaForm floors={floors} onCreated={reload} />
        <table className="floor-map-admin__table">
          <thead>
            <tr>
              <th>지역</th>
              <th>층</th>
              <th>현재 배경</th>
              <th>이미지 매핑</th>
            </tr>
          </thead>
          <tbody>
            {areas.map((a) => (
              <AreaRow
                key={a.id}
                area={a}
                images={images}
                onUpdated={(updated) => setAreas((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
                onDeleted={(areaId) => setAreas((prev) => prev.filter((x) => x.id !== areaId))}
              />
            ))}
            {areas.length === 0 && (
              <tr>
                <td colSpan={4} className="floor-map-admin__empty">
                  등록된 지역이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
