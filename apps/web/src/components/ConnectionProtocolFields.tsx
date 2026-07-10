import { useEffect, useState } from "react";
import { ApiError, setDeviceConnection } from "../lib/api";

const PROTOCOLS = ["TCP_IP", "SERIAL", "MODBUS_TCP", "MODBUS_RTU", "ZIGBEE", "ZWAVE"] as const;
type Protocol = (typeof PROTOCOLS)[number];

interface ConfigState {
  host?: string;
  port?: string;
  unitId?: string;
  comPort?: string;
  baudRate?: string;
  dataBits?: string;
  parity?: string;
  stopBits?: string;
  panId?: string;
  ieeeAddress?: string;
  endpoint?: string;
  homeId?: string;
  nodeId?: string;
}

interface Props {
  deviceId: string;
  currentProtocol: string | null;
  currentConfig: unknown;
  onSaved?: () => void;
}

/**
 * Device↔Gateway 연결 프로토콜 설정 폼. 프로토콜별 동적 필드를 렌더하고
 * PATCH /devices/:id/connection 을 호출한다. 기기 생성 폼과 목록 행 양쪽에서 재사용.
 */
export function ConnectionProtocolFields({
  deviceId,
  currentProtocol,
  currentConfig,
  onSaved,
}: Props): JSX.Element {
  const initial = (currentConfig as ConfigState | null) ?? {};
  const [protocol, setProtocol] = useState<string>(currentProtocol ?? "");
  const [config, setConfig] = useState<ConfigState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setProtocol(currentProtocol ?? "");
    setConfig((currentConfig as ConfigState | null) ?? {});
  }, [currentProtocol, currentConfig]);

  const reset = (p: string) => {
    setProtocol(p);
    setConfig({});
    setError(null);
    setDone(false);
  };

  const handleSave = () => {
    setSaving(true);
    setError(null);
    setDone(false);

    // 프로토콜이 없으면 null(설정 해제)
    if (!protocol) {
      setDeviceConnection(deviceId, { protocol: null })
        .then(() => {
          setDone(true);
          onSaved?.();
        })
        .catch((err: unknown) =>
          setError(err instanceof ApiError ? err.detail : "저장에 실패했습니다."),
        )
        .finally(() => setSaving(false));
      return;
    }

    // 숫자 필드 변환
    const cfg: Record<string, unknown> = {};
    const p = protocol as Protocol;
    if (p === "TCP_IP") {
      cfg.host = config.host ?? "";
      cfg.port = Number(config.port) || 0;
    } else if (p === "SERIAL") {
      cfg.comPort = config.comPort ?? "";
      cfg.baudRate = Number(config.baudRate) || 0;
      if (config.dataBits) cfg.dataBits = Number(config.dataBits);
      if (config.parity) cfg.parity = config.parity;
      if (config.stopBits) cfg.stopBits = Number(config.stopBits);
    } else if (p === "MODBUS_TCP") {
      cfg.host = config.host ?? "";
      cfg.port = Number(config.port) || 0;
      cfg.unitId = config.unitId === undefined || config.unitId === "" ? 0 : Number(config.unitId);
    } else if (p === "MODBUS_RTU") {
      cfg.comPort = config.comPort ?? "";
      cfg.baudRate = Number(config.baudRate) || 0;
      cfg.unitId = config.unitId === undefined || config.unitId === "" ? 0 : Number(config.unitId);
      if (config.dataBits) cfg.dataBits = Number(config.dataBits);
      if (config.parity) cfg.parity = config.parity;
      if (config.stopBits) cfg.stopBits = Number(config.stopBits);
    } else if (p === "ZIGBEE") {
      if (config.panId) cfg.panId = config.panId;
      if (config.ieeeAddress) cfg.ieeeAddress = config.ieeeAddress;
      if (config.endpoint) cfg.endpoint = Number(config.endpoint);
    } else if (p === "ZWAVE") {
      if (config.homeId) cfg.homeId = config.homeId;
      if (config.nodeId) cfg.nodeId = Number(config.nodeId);
    }

    setDeviceConnection(deviceId, { protocol, config: cfg })
      .then(() => {
        setDone(true);
        onSaved?.();
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.detail : "저장에 실패했습니다."),
      )
      .finally(() => setSaving(false));
  };

  return (
    <div className="connection-fields">
      <label>
        프로토콜{" "}
        <select value={protocol} onChange={(e) => reset(e.target.value)}>
          <option value="">없음 (직결 MQTT)</option>
          {PROTOCOLS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>

      {protocol === "TCP_IP" && (
        <>
          <input placeholder="host" value={config.host ?? ""} onChange={(e) => setConfig({ ...config, host: e.target.value })} />
          <input placeholder="port" type="number" value={config.port ?? ""} onChange={(e) => setConfig({ ...config, port: e.target.value })} />
        </>
      )}

      {(protocol === "SERIAL" || protocol === "MODBUS_RTU") && (
        <>
          <input placeholder="comPort (예: COM3)" value={config.comPort ?? ""} onChange={(e) => setConfig({ ...config, comPort: e.target.value })} />
          <input placeholder="baudRate" type="number" value={config.baudRate ?? ""} onChange={(e) => setConfig({ ...config, baudRate: e.target.value })} />
          <input placeholder="dataBits (5-8)" type="number" value={config.dataBits ?? ""} onChange={(e) => setConfig({ ...config, dataBits: e.target.value })} />
          <select value={config.parity ?? ""} onChange={(e) => setConfig({ ...config, parity: e.target.value })}>
            <option value="">parity (생략=none)</option>
            <option value="none">none</option>
            <option value="even">even</option>
            <option value="odd">odd</option>
          </select>
          <input placeholder="stopBits (1/1.5/2)" type="number" step="0.5" value={config.stopBits ?? ""} onChange={(e) => setConfig({ ...config, stopBits: e.target.value })} />
        </>
      )}

      {protocol === "MODBUS_TCP" && (
        <>
          <input placeholder="host" value={config.host ?? ""} onChange={(e) => setConfig({ ...config, host: e.target.value })} />
          <input placeholder="port" type="number" value={config.port ?? ""} onChange={(e) => setConfig({ ...config, port: e.target.value })} />
          <input placeholder="unitId (0-247)" type="number" value={config.unitId ?? ""} onChange={(e) => setConfig({ ...config, unitId: e.target.value })} />
        </>
      )}

      {protocol === "MODBUS_RTU" && (
        <input placeholder="unitId (0-247)" type="number" value={config.unitId ?? ""} onChange={(e) => setConfig({ ...config, unitId: e.target.value })} />
      )}

      {protocol === "ZIGBEE" && (
        <>
          <input placeholder="panId" value={config.panId ?? ""} onChange={(e) => setConfig({ ...config, panId: e.target.value })} />
          <input placeholder="ieeeAddress" value={config.ieeeAddress ?? ""} onChange={(e) => setConfig({ ...config, ieeeAddress: e.target.value })} />
          <input placeholder="endpoint" type="number" value={config.endpoint ?? ""} onChange={(e) => setConfig({ ...config, endpoint: e.target.value })} />
        </>
      )}

      {protocol === "ZWAVE" && (
        <>
          <input placeholder="homeId" value={config.homeId ?? ""} onChange={(e) => setConfig({ ...config, homeId: e.target.value })} />
          <input placeholder="nodeId" type="number" value={config.nodeId ?? ""} onChange={(e) => setConfig({ ...config, nodeId: e.target.value })} />
        </>
      )}

      {error && <span className="error-text">{error}</span>}
      {done && <span className="success-text">저장됨</span>}

      <button type="button" className="primary" onClick={handleSave} disabled={saving}>
        {saving ? "저장 중…" : "연결 설정 저장"}
      </button>
    </div>
  );
}
