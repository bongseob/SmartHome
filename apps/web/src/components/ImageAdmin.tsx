import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { ApiError, apiAssetUrl, deleteImage, listImages, updateImage, uploadImage } from "../lib/api";
import type { ImageRecord } from "../lib/types";
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

interface UploadFormProps {
  onCreated: (image: ImageRecord) => void;
}

function UploadForm({ onCreated }: UploadFormProps): JSX.Element {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
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
      const created = await uploadImage(file, {
        name: imageName,
        description: description.trim() || undefined,
        widthPx: width,
        heightPx: height,
      });
      onCreated(created);
      setName("");
      setDescription("");
      setFile(null);
      e.currentTarget.reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "이미지 등록에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="floor-map-admin__upload" onSubmit={handleSubmit}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이미지 이름" />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="용도 설명 (예: 1층 로비 배경)"
      />
      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} />
      <button type="submit" className="primary" disabled={submitting}>
        {submitting ? "등록 중…" : "이미지 등록"}
      </button>
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}

interface ImageRowProps {
  image: ImageRecord;
  onUpdated: (image: ImageRecord) => void;
  onDelete: () => void;
}

/** 이름/설명 수정 + 파일 교체(id 유지 — 이 이미지를 배경으로 참조하는 지역은 다시 매핑할 필요 없음). */
function ImageRow({ image, onUpdated, onDelete }: ImageRowProps): JSX.Element {
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(image.name);
  const [savingName, setSavingName] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionInput, setDescriptionInput] = useState(image.description ?? "");
  const [savingDescription, setSavingDescription] = useState(false);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSaveName = () => {
    if (!nameInput.trim()) return;
    setSavingName(true);
    setError(null);
    updateImage(image.id, { name: nameInput.trim() })
      .then((updated) => {
        onUpdated(updated);
        setEditingName(false);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.detail : "이름 저장에 실패했습니다."))
      .finally(() => setSavingName(false));
  };

  const handleSaveDescription = () => {
    setSavingDescription(true);
    setError(null);
    updateImage(image.id, { description: descriptionInput.trim() })
      .then((updated) => {
        onUpdated(updated);
        setEditingDescription(false);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.detail : "설명 저장에 실패했습니다."))
      .finally(() => setSavingDescription(false));
  };

  const handleReplaceFile = async () => {
    if (!replaceFile) {
      setError("교체할 파일을 선택하세요.");
      return;
    }
    setReplacing(true);
    setError(null);
    try {
      const { width, height } = await readImageDimensions(replaceFile);
      const updated = await updateImage(image.id, { file: replaceFile, widthPx: width, heightPx: height });
      onUpdated(updated);
      setReplaceFile(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "파일 교체에 실패했습니다.");
    } finally {
      setReplacing(false);
    }
  };

  return (
    <tr>
      <td>
        <img src={apiAssetUrl(image.imageUrl) ?? ""} alt={image.name} className="floor-map-admin__thumb" />
      </td>
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
                setNameInput(image.name);
                setEditingName(false);
              }}
            >
              취소
            </button>
          </>
        ) : (
          <>
            {image.name}{" "}
            <button type="button" onClick={() => setEditingName(true)}>
              이름 수정
            </button>
          </>
        )}
      </td>
      <td>
        {editingDescription ? (
          <>
            <input
              value={descriptionInput}
              onChange={(e) => setDescriptionInput(e.target.value)}
              placeholder="용도 설명"
            />
            <button type="button" className="primary" onClick={handleSaveDescription} disabled={savingDescription}>
              {savingDescription ? "저장 중…" : "저장"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDescriptionInput(image.description ?? "");
                setEditingDescription(false);
              }}
            >
              취소
            </button>
          </>
        ) : (
          <>
            {image.description ?? <span className="floor-map-admin__empty">없음</span>}{" "}
            <button type="button" onClick={() => setEditingDescription(true)}>
              설명 수정
            </button>
          </>
        )}
      </td>
      <td>{image.widthPx && image.heightPx ? `${image.widthPx}×${image.heightPx}px` : "-"}</td>
      <td>{new Date(image.uploadedAt).toLocaleString()}</td>
      <td>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => setReplaceFile(e.target.files?.[0] ?? null)}
        />
        <button type="button" onClick={handleReplaceFile} disabled={replacing || !replaceFile}>
          {replacing ? "교체 중…" : "파일 교체"}
        </button>
        <button type="button" onClick={onDelete}>
          삭제
        </button>
        {error && <p className="error-text">{error}</p>}
      </td>
    </tr>
  );
}

export function ImageAdmin(): JSX.Element {
  const confirm = useConfirm();
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    listImages()
      .then((result) => {
        setImages(result);
        setLoadError(null);
      })
      .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.detail : "이미지 목록을 불러오지 못했습니다."));
  }, []);

  const handleDelete = (image: ImageRecord) => {
    confirm(`'${image.name}' 이미지를 삭제할까요? 이 이미지를 배경으로 쓰는 지역은 배경 없음 상태가 됩니다.`, {
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      deleteImage(image.id)
        .then(() => setImages((prev) => prev.filter((x) => x.id !== image.id)))
        .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.detail : "이미지 삭제에 실패했습니다."));
    });
  };

  return (
    <div className="floor-map-admin">
      <h2>이미지 관리</h2>
      <p className="floor-map-admin__note">
        재사용 가능한 배경 이미지를 등록·관리합니다. 이름과 별개로 "설명"에 이 이미지의 용도를
        남겨두면(예: "1층 로비 배경"), 지역 배경 외에 다른 곳에 재사용될 때도 무엇인지 파악하기
        쉽습니다. 실제 배경 적용은 "지역 관리" 화면에서 별도로 매핑합니다.
      </p>

      {loadError && <p className="error-text">{loadError}</p>}

      <UploadForm onCreated={(image) => setImages((prev) => [image, ...prev])} />

      <table className="floor-map-admin__table">
        <thead>
          <tr>
            <th>이미지</th>
            <th>이름</th>
            <th>설명</th>
            <th>크기</th>
            <th>등록일</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          {images.map((image) => (
            <ImageRow
              key={image.id}
              image={image}
              onUpdated={(updated) => setImages((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
              onDelete={() => handleDelete(image)}
            />
          ))}
          {images.length === 0 && (
            <tr>
              <td colSpan={6} className="floor-map-admin__empty">
                등록된 이미지가 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
