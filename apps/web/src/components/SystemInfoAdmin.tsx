import { useEffect, useState } from "react";
import {
  ApiError,
  listBuildings,
  listSites,
  listSystemSettings,
  updateBuildingName,
  updateSiteName,
  updateSystemSetting,
} from "../lib/api";
import type { BuildingRecord, SiteRecord, SystemSettingRecord } from "../lib/types";

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

interface SystemNameFieldProps {
  value: string;
  onSaved: (setting: SystemSettingRecord) => void;
}

/** 시스템 표시 이름 — 로그인 화면·상단 헤더·브라우저 탭에 쓰인다(2026-07-15 추가). */
function SystemNameField({ value, onSaved }: SystemNameFieldProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    if (!input.trim()) {
      setError("이름은 비울 수 없습니다.");
      return;
    }
    setSaving(true);
    setError(null);
    updateSystemSetting("system.name", input.trim())
      .then((updated) => {
        onSaved(updated);
        setEditing(false);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.detail : "저장에 실패했습니다."))
      .finally(() => setSaving(false));
  };

  return (
    <div className="system-info__field">
      {editing ? (
        <>
          <input value={input} onChange={(e) => setInput(e.target.value)} disabled={saving} />
          <button type="button" className="primary" onClick={handleSave} disabled={saving}>
            {saving ? "저장 중…" : "저장"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setInput(value);
              setError(null);
            }}
            disabled={saving}
          >
            취소
          </button>
        </>
      ) : (
        <>
          <strong>{value}</strong>
          <button type="button" onClick={() => setEditing(true)}>
            수정
          </button>
        </>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

interface LegacyBridgeSectionProps {
  serverEndpoint: { host: string; port: number };
  boardDefaultPort: number;
  onSaved: (setting: SystemSettingRecord) => void;
}

/** 레거시 감시장비 브리지 설정 — system_setting에만 있던 값을 관리자가 편집 가능하게 노출(2026-07-15). */
function LegacyBridgeSection({ serverEndpoint, boardDefaultPort, onSaved }: LegacyBridgeSectionProps): JSX.Element {
  const [host, setHost] = useState(serverEndpoint.host);
  const [port, setPort] = useState(String(serverEndpoint.port));
  const [boardPort, setBoardPort] = useState(String(boardDefaultPort));
  const [savingEndpoint, setSavingEndpoint] = useState(false);
  const [savingBoardPort, setSavingBoardPort] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSaveEndpoint = () => {
    const portNum = Number(port);
    if (!host.trim() || !Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setError("host와 1~65535 사이의 port를 입력하세요.");
      return;
    }
    setSavingEndpoint(true);
    setError(null);
    updateSystemSetting("legacy.server_endpoint", { host: host.trim(), port: portNum })
      .then(onSaved)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.detail : "저장에 실패했습니다."))
      .finally(() => setSavingEndpoint(false));
  };

  const handleSaveBoardPort = () => {
    const portNum = Number(boardPort);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setError("1~65535 사이의 port를 입력하세요.");
      return;
    }
    setSavingBoardPort(true);
    setError(null);
    updateSystemSetting("legacy.board_default_port", portNum)
      .then(onSaved)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.detail : "저장에 실패했습니다."))
      .finally(() => setSavingBoardPort(false));
  };

  return (
    <>
      <h3>레거시 브리지 설정</h3>
      <p className="system-info__note">
        레거시 감시장비(보드)와 통신하는 엣지 브리지의 서버 리슨 주소/포트, 보드 기본 통신 포트입니다.
      </p>
      <div className="system-info__field">
        <label>
          host <input value={host} onChange={(e) => setHost(e.target.value)} disabled={savingEndpoint} />
        </label>
        <label>
          port <input value={port} onChange={(e) => setPort(e.target.value)} disabled={savingEndpoint} />
        </label>
        <button type="button" className="primary" onClick={handleSaveEndpoint} disabled={savingEndpoint}>
          {savingEndpoint ? "저장 중…" : "저장"}
        </button>
      </div>
      <div className="system-info__field">
        <label>
          board_default_port{" "}
          <input value={boardPort} onChange={(e) => setBoardPort(e.target.value)} disabled={savingBoardPort} />
        </label>
        <button type="button" className="primary" onClick={handleSaveBoardPort} disabled={savingBoardPort}>
          {savingBoardPort ? "저장 중…" : "저장"}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </>
  );
}

export function SystemInfoAdmin(): JSX.Element {
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [buildings, setBuildings] = useState<BuildingRecord[]>([]);
  const [systemSettings, setSystemSettings] = useState<SystemSettingRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = () => {
    Promise.all([listSites(), listBuildings(), listSystemSettings()])
      .then(([s, b, settings]) => {
        setSites(s);
        setBuildings(b);
        setSystemSettings(settings);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof ApiError ? err.detail : "정보를 불러오지 못했습니다.");
      });
  };

  useEffect(reload, []);

  const applySettingUpdate = (updated: SystemSettingRecord) => {
    setSystemSettings((prev) => prev.map((s) => (s.key === updated.key ? updated : s)));
  };

  const systemName = systemSettings.find((s) => s.key === "system.name");
  const serverEndpoint = systemSettings.find((s) => s.key === "legacy.server_endpoint");
  const boardDefaultPort = systemSettings.find((s) => s.key === "legacy.board_default_port");

  const siteName = (siteId: string) => sites.find((s) => s.id === siteId)?.name ?? siteId.slice(0, 8);

  return (
    <div className="system-info">
      <h2>시스템 기본정보</h2>
      <p className="system-info__note">
        Site/Building 이름만 수정할 수 있습니다. 조직 계층 생성·삭제는 이 화면의 범위 밖입니다.
      </p>

      {loadError && <p className="error-text">{loadError}</p>}

      <h3>시스템 명</h3>
      <p className="system-info__note">
        로그인 화면·상단 헤더·브라우저 탭에 표시되는 이름입니다. 변경 사항은 새로고침 후 반영됩니다.
      </p>
      {systemName && (
        <SystemNameField value={systemName.value as string} onSaved={applySettingUpdate} />
      )}

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

      {serverEndpoint && boardDefaultPort && (
        <LegacyBridgeSection
          serverEndpoint={serverEndpoint.value as { host: string; port: number }}
          boardDefaultPort={boardDefaultPort.value as number}
          onSaved={applySettingUpdate}
        />
      )}
    </div>
  );
}
