import { useEffect, useState } from "react";
import {
  ApiError,
  listBuildings,
  listSites,
  updateBuildingName,
  updateSiteName,
} from "../lib/api";
import type { BuildingRecord, SiteRecord } from "../lib/types";

interface EditableRowProps {
  id: string;
  slug: string;
  name: string;
  extra?: string;
  onSave: (id: string, name: string) => Promise<unknown>;
}

function EditableRow({ id, slug, name, extra, onSave }: EditableRowProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    if (!value.trim()) {
      setError("이름은 비울 수 없습니다.");
      return;
    }
    setSaving(true);
    setError(null);
    onSave(id, value.trim())
      .then(() => setEditing(false))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.detail : "저장에 실패했습니다.");
      })
      .finally(() => setSaving(false));
  };

  return (
    <tr>
      <td className="system-info__slug">{slug}</td>
      {extra !== undefined && <td>{extra}</td>}
      <td>
        {editing ? (
          <input value={value} onChange={(e) => setValue(e.target.value)} disabled={saving} />
        ) : (
          name
        )}
      </td>
      <td>
        {editing ? (
          <>
            <button type="button" className="primary" onClick={handleSave} disabled={saving}>
              {saving ? "저장 중…" : "저장"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setValue(name);
                setError(null);
              }}
              disabled={saving}
            >
              취소
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setEditing(true)}>
            수정
          </button>
        )}
        {error && <p className="error-text">{error}</p>}
      </td>
    </tr>
  );
}

export function SystemInfoAdmin(): JSX.Element {
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [buildings, setBuildings] = useState<BuildingRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = () => {
    Promise.all([listSites(), listBuildings()])
      .then(([s, b]) => {
        setSites(s);
        setBuildings(b);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof ApiError ? err.detail : "정보를 불러오지 못했습니다.");
      });
  };

  useEffect(reload, []);

  const siteName = (siteId: string) => sites.find((s) => s.id === siteId)?.name ?? siteId.slice(0, 8);

  return (
    <div className="system-info">
      <h2>시스템 기본정보</h2>
      <p className="system-info__note">
        Site/Building 이름만 수정할 수 있습니다. 조직 계층 생성·삭제는 이 화면의 범위 밖입니다.
      </p>

      {loadError && <p className="error-text">{loadError}</p>}

      <h3>Site</h3>
      <table className="system-info__table">
        <thead>
          <tr>
            <th>slug</th>
            <th>이름</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sites.map((s) => (
            <EditableRow
              key={s.id}
              id={s.id}
              slug={s.slug}
              name={s.name}
              onSave={(id, name) =>
                updateSiteName(id, name).then((updated) => {
                  setSites((prev) => prev.map((x) => (x.id === id ? updated : x)));
                })
              }
            />
          ))}
        </tbody>
      </table>

      <h3>Building</h3>
      <table className="system-info__table">
        <thead>
          <tr>
            <th>slug</th>
            <th>Site</th>
            <th>이름</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {buildings.map((b) => (
            <EditableRow
              key={b.id}
              id={b.id}
              slug={b.slug}
              extra={siteName(b.siteId)}
              name={b.name}
              onSave={(id, name) =>
                updateBuildingName(id, name).then((updated) => {
                  setBuildings((prev) => prev.map((x) => (x.id === id ? updated : x)));
                })
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
