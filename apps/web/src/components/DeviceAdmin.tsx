import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  createDevice,
  decommissionDevice,
  getFloorOverview,
  listDevices,
  listFloors,
  updateDevice,
} from "../lib/api";
import type {
  CreateDeviceRequest,
  DeviceListItem,
  FloorOverview,
  FloorSummary,
} from "../lib/types";
import { ConnectionProtocolFields } from "./ConnectionProtocolFields";

const CATEGORIES = ["DEVICE", "SENSOR", "GATEWAY"] as const;

export function DeviceAdmin(): JSX.Element {
  const [floors, setFloors] = useState<FloorSummary[]>([]);
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [overview, setOverview] = useState<FloorOverview | null>(null);
  const [devices, setDevices] = useState<DeviceListItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 생성 폼
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("DEVICE");
  const [deviceType, setDeviceType] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [firmwareVersion, setFirmwareVersion] = useState("");
  const [areaId, setAreaId] = useState("");
  const [gatewayId, setGatewayId] = useState("");
  const [gateways, setGateways] = useState<DeviceListItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // 연결 설정 표시
  const [connectionDeviceId, setConnectionDeviceId] = useState<string | null>(null);

  useEffect(() => {
    listFloors()
      .then((result) => {
        setFloors(result);
        setSelectedFloorId((current) => current ?? result[0]?.id ?? null);
      })
      .catch((err: unknown) =>
        setLoadError(err instanceof ApiError ? err.detail : "층 목록을 불러오지 못했습니다."),
      );
  }, []);

  // Gateway 목록 (category=GROUP은 별도, GATEWAY만)
  useEffect(() => {
    listDevices({ category: "GATEWAY" })
      .then(setGateways)
      .catch(() => undefined);
  }, []);

  const reloadOverview = useCallback((floorId: string) => {
    getFloorOverview(floorId)
      .then((result) => {
        setOverview(result);
        setDevices(result.devices);
        setLoadError(null);
      })
      .catch((err: unknown) =>
        setLoadError(err instanceof ApiError ? err.detail : "층 정보를 불러오지 못했습니다."),
      );
  }, []);

  useEffect(() => {
    if (selectedFloorId) reloadOverview(selectedFloorId);
  }, [selectedFloorId, reloadOverview]);

  const areas = overview?.areas ?? [];

  const handleCreate = () => {
    if (!code.trim() || !name.trim() || !areaId) {
      setCreateError("code, name, area는 필수입니다.");
      return;
    }
    setCreating(true);
    setCreateError(null);

    const body: CreateDeviceRequest = {
      code: code.trim(),
      name: name.trim(),
      category,
      deviceType: deviceType.trim() || null,
      manufacturer: manufacturer.trim() || null,
      model: model.trim() || null,
      firmwareVersion: firmwareVersion.trim() || null,
      areaId,
      gatewayId: gatewayId || null,
    };

    createDevice(body)
      .then(() => {
        // 폼 초기화
        setCode("");
        setName("");
        setDeviceType("");
        setManufacturer("");
        setModel("");
        setFirmwareVersion("");
        setGatewayId("");
        if (selectedFloorId) reloadOverview(selectedFloorId);
      })
      .catch((err: unknown) =>
        setCreateError(err instanceof ApiError ? err.detail : "생성에 실패했습니다."),
      )
      .finally(() => setCreating(false));
  };

  const handleDecommission = (device: DeviceListItem) => {
    if (!window.confirm(`'${device.name}' (${device.code}) 기기를 폐기할까요?\n소프트 전이로 lifecycle이 DECOMMISSIONED로 변경됩니다. 이력은 보존됩니다.`)) {
      return;
    }
    decommissionDevice(device.id)
      .then(() => {
        if (selectedFloorId) reloadOverview(selectedFloorId);
      })
      .catch((err: unknown) =>
        setLoadError(err instanceof ApiError ? err.detail : "폐기에 실패했습니다."),
      );
  };

  return (
    <div className="device-admin">
      <h2>기기 등록/설정</h2>
      <p className="device-admin__note">
        기기를 생성하면 mqtt_topic이 자동으로 생성됩니다(UNS: enterprise/site/building/floor/area/code).
        area/code/mqtt_topic은 생성 후 불변 — 위치 이동은 폐기 후 재등록으로 처리합니다.
      </p>

      <label className="device-admin__floor-select">
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

      {/* ─── 생성 폼 ─── */}
      <div className="device-admin__create">
        <h3>새 기기 추가</h3>
        <div className="device-admin__form">
          <input
            placeholder="code (소문자-하이픈, 예: living-light-01)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <input placeholder="이름 (필수)" value={name} onChange={(e) => setName(e.target.value)} />
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            <option value="">Area 선택 (필수)</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.slug})
              </option>
            ))}
          </select>
          <input placeholder="deviceType" value={deviceType} onChange={(e) => setDeviceType(e.target.value)} />
          <input placeholder="manufacturer" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
          <input placeholder="model" value={model} onChange={(e) => setModel(e.target.value)} />
          <input placeholder="firmwareVersion" value={firmwareVersion} onChange={(e) => setFirmwareVersion(e.target.value)} />
          <select value={gatewayId} onChange={(e) => setGatewayId(e.target.value)}>
            <option value="">Gateway (선택)</option>
            {gateways.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.code})
              </option>
            ))}
          </select>
        </div>
        {createError && <p className="error-text">{createError}</p>}
        <button type="button" className="primary" onClick={handleCreate} disabled={creating}>
          {creating ? "생성 중…" : "기기 생성"}
        </button>
      </div>

      {/* ─── 기기 목록 ─── */}
      <table className="device-admin__table">
        <thead>
          <tr>
            <th>이름</th>
            <th>code</th>
            <th>카테고리</th>
            <th>mqtt_topic</th>
            <th>lifecycle</th>
            <th>연결</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {devices.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              onDecommission={() => handleDecommission(device)}
              onToggleConnection={() =>
                setConnectionDeviceId((prev) => (prev === device.id ? null : device.id))
              }
              showConnection={connectionDeviceId === device.id}
              onConnectionSaved={() => {
                if (selectedFloorId) reloadOverview(selectedFloorId);
              }}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface DeviceRowProps {
  device: DeviceListItem;
  onDecommission: () => void;
  onToggleConnection: () => void;
  showConnection: boolean;
  onConnectionSaved: () => void;
}

function DeviceRow({
  device,
  onDecommission,
  onToggleConnection,
  showConnection,
  onConnectionSaved,
}: DeviceRowProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.name);
  const [deviceType, setDeviceType] = useState(device.deviceType ?? "");
  const [manufacturer, setManufacturer] = useState(device.manufacturer ?? "");
  const [model, setModel] = useState(device.model ?? "");
  const [firmwareVersion, setFirmwareVersion] = useState(device.firmwareVersion ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    setSaving(true);
    setError(null);
    updateDevice(device.id, {
      name: name.trim(),
      deviceType: deviceType.trim() || null,
      manufacturer: manufacturer.trim() || null,
      model: model.trim() || null,
      firmwareVersion: firmwareVersion.trim() || null,
    })
      .then(() => setEditing(false))
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.detail : "저장에 실패했습니다."),
      )
      .finally(() => setSaving(false));
  };

  const isDecommissioned = device.lifecycleStatus === "DECOMMISSIONED";

  return (
    <>
      <tr className={isDecommissioned ? "device-admin__row--decommissioned" : ""}>
        <td>
          {editing ? (
            <input value={name} onChange={(e) => setName(e.target.value)} />
          ) : (
            device.name
          )}
        </td>
        <td className="device-admin__code">{device.code}</td>
        <td>{device.category}</td>
        <td className="device-admin__topic">{device.mqttTopic}</td>
        <td>
          <span className={`lifecycle-badge lifecycle-badge--${device.lifecycleStatus.toLowerCase()}`}>
            {device.lifecycleStatus}
          </span>
        </td>
        <td>{device.connectionProtocol ?? "—"}</td>
        <td>
          {editing ? (
            <>
              <button type="button" className="primary" onClick={handleSave} disabled={saving}>
                {saving ? "저장 중…" : "저장"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setName(device.name);
                  setDeviceType(device.deviceType ?? "");
                  setManufacturer(device.manufacturer ?? "");
                  setModel(device.model ?? "");
                  setFirmwareVersion(device.firmwareVersion ?? "");
                  setEditing(false);
                }}
              >
                취소
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setEditing(true)} disabled={isDecommissioned}>
                수정
              </button>
              <button type="button" onClick={onToggleConnection} disabled={isDecommissioned}>
                연결 설정
              </button>
              <button type="button" onClick={onDecommission} disabled={isDecommissioned}>
                폐기
              </button>
            </>
          )}
          {error && <div className="error-text">{error}</div>}
        </td>
      </tr>
      {showConnection && (
        <tr className="device-admin__connection-row">
          <td colSpan={7}>
            <ConnectionProtocolFields
              deviceId={device.id}
              currentProtocol={device.connectionProtocol}
              currentConfig={device.connectionConfig}
              onSaved={onConnectionSaved}
            />
          </td>
        </tr>
      )}
    </>
  );
}
