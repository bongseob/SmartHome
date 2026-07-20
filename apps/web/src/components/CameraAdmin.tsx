import { useEffect, useState, type FormEvent } from "react";
import type { CameraProtocol } from "@smarthome/contracts";
import {
  addCameraCoverage,
  ApiError,
  createCamera,
  createCameraPreset,
  listAreas,
  listCameraPresets,
  listCameras,
  ptzGotoPreset,
  ptzMove,
  removeCameraCoverage,
  updateCamera,
} from "../lib/api";
import type { AreaSummary, CameraPresetRecord, CameraSummary as CameraSummaryType } from "../lib/types";

const CAMERA_PROTOCOLS: CameraProtocol[] = ["RTSP", "WEBRTC", "HLS", "ONVIF"];

interface NewCameraFormProps {
  areas: AreaSummary[];
  onCreated: (camera: CameraSummaryType) => void;
}

function NewCameraForm({ areas, onCreated }: NewCameraFormProps): JSX.Element {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [protocol, setProtocol] = useState<CameraProtocol>("RTSP");
  const [streamUrl, setStreamUrl] = useState("");
  const [onvifEndpoint, setOnvifEndpoint] = useState("");
  const [onvifUsername, setOnvifUsername] = useState("");
  const [onvifPassword, setOnvifPassword] = useState("");
  const [isPtz, setIsPtz] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // areas는 부모에서 비동기로 로드된다 — 첫 렌더 시점엔 []이라 위 useState 초기값이 ""로 고정될 수
  // 있다. 목록이 뒤늦게 채워지면 아직 선택 안 한 경우에 한해 첫 지역으로 동기화한다.
  useEffect(() => {
    if (!areaId && areas.length > 0) {
      setAreaId(areas[0].id);
    }
  }, [areas, areaId]);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!code.trim() || !name.trim() || !areaId || !streamUrl.trim()) {
      setError("code, name, 지역, streamUrl은 필수입니다.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setDone(false);
    createCamera({
      code: code.trim(),
      name: name.trim(),
      areaId,
      protocol,
      streamUrl: streamUrl.trim(),
      onvifEndpoint: protocol === "ONVIF" ? onvifEndpoint.trim() || null : null,
      onvifUsername: protocol === "ONVIF" ? onvifUsername.trim() || null : null,
      onvifPassword: protocol === "ONVIF" ? onvifPassword.trim() || null : null,
      isPtz,
    })
      .then((camera) => {
        onCreated(camera);
        setCode("");
        setName("");
        setStreamUrl("");
        setOnvifEndpoint("");
        setOnvifUsername("");
        setOnvifPassword("");
        setIsPtz(false);
        setDone(true);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.detail : "카메라 등록에 실패했습니다."))
      .finally(() => setSubmitting(false));
  };

  return (
    <form className="device-admin__form" onSubmit={handleSubmit}>
      <label>
        code
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="예: cam-lobby-01" />
      </label>
      <label>
        이름
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 1층 로비 카메라" />
      </label>
      <label>
        설치 지역
        <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
          {areas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        프로토콜
        <select value={protocol} onChange={(e) => setProtocol(e.target.value as CameraProtocol)}>
          {CAMERA_PROTOCOLS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label>
        스트림 URL(RTSP)
        <input
          value={streamUrl}
          onChange={(e) => setStreamUrl(e.target.value)}
          placeholder="rtsp://mediamtx:8554/cam-01"
        />
      </label>
      {protocol === "ONVIF" && (
        <>
          <label>
            ONVIF 엔드포인트
            <input value={onvifEndpoint} onChange={(e) => setOnvifEndpoint(e.target.value)} placeholder="http://cam-ip/onvif/device_service" />
          </label>
          <label>
            ONVIF 사용자명
            <input value={onvifUsername} onChange={(e) => setOnvifUsername(e.target.value)} autoComplete="off" />
          </label>
          <label>
            ONVIF 비밀번호
            <input type="password" value={onvifPassword} onChange={(e) => setOnvifPassword(e.target.value)} autoComplete="new-password" />
          </label>
        </>
      )}
      <label>
        <input type="checkbox" checked={isPtz} onChange={(e) => setIsPtz(e.target.checked)} />
        PTZ 지원
      </label>
      <button type="submit" className="primary" disabled={submitting || areas.length === 0}>
        {submitting ? "등록 중…" : "카메라 등록"}
      </button>
      {areas.length === 0 && <p className="error-text">먼저 지역을 하나 이상 만들어야 합니다.</p>}
      {error && <p className="error-text">{error}</p>}
      {done && <p className="success-text">카메라가 등록되었습니다.</p>}
    </form>
  );
}

interface CameraEditModalProps {
  camera: CameraSummaryType;
  areas: AreaSummary[];
  onCancel: () => void;
  onSaved: (camera: CameraSummaryType) => void;
}

/** 스트림·PTZ·설치 방향 수정 + 프리셋 관리 + 커버 지역 매핑을 한 모달에서 처리한다. */
function CameraEditModal({ camera, areas, onCancel, onSaved }: CameraEditModalProps): JSX.Element {
  const [streamUrl, setStreamUrl] = useState(camera.streamUrl);
  const [onvifEndpoint, setOnvifEndpoint] = useState(camera.onvifEndpoint ?? "");
  // ONVIF 자격은 조회 응답에 절대 포함되지 않으므로(비밀번호 노출 방지) 항상 빈 칸에서 시작한다 —
  // 비워두고 저장하면 기존 값을 그대로 둔다(변경할 때만 입력).
  const [onvifUsername, setOnvifUsername] = useState("");
  const [onvifPassword, setOnvifPassword] = useState("");
  const [isPtz, setIsPtz] = useState(camera.isPtz);
  const [resolution, setResolution] = useState(camera.resolution ?? "");
  const [fovDeg, setFovDeg] = useState(camera.fovDeg !== null ? String(camera.fovDeg) : "");
  const [headingDeg, setHeadingDeg] = useState(camera.headingDeg !== null ? String(camera.headingDeg) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [presets, setPresets] = useState<CameraPresetRecord[]>([]);
  const [presetName, setPresetName] = useState("");
  const [presetPan, setPresetPan] = useState("");
  const [presetTilt, setPresetTilt] = useState("");
  const [presetZoom, setPresetZoom] = useState("");
  const [presetError, setPresetError] = useState<string | null>(null);

  const [ptzPan, setPtzPan] = useState("");
  const [ptzTilt, setPtzTilt] = useState("");
  const [ptzZoom, setPtzZoom] = useState("");
  const [ptzStatus, setPtzStatus] = useState<string | null>(null);
  const [ptzError, setPtzError] = useState<string | null>(null);

  const [coverageAreaId, setCoverageAreaId] = useState(areas[0]?.id ?? "");
  const [coverageError, setCoverageError] = useState<string | null>(null);

  useEffect(() => {
    listCameraPresets(camera.deviceId)
      .then(setPresets)
      .catch(() => undefined);
  }, [camera.deviceId]);

  // areas가 이 모달이 뜬 뒤에야 늦게 채워지는 경우(드문 레이스)를 대비 — NewCameraForm과 동일 패턴.
  useEffect(() => {
    if (!coverageAreaId && areas.length > 0) {
      setCoverageAreaId(areas[0].id);
    }
  }, [areas, coverageAreaId]);

  const handleSave = () => {
    setSaving(true);
    setError(null);
    updateCamera(camera.deviceId, {
      streamUrl: streamUrl.trim(),
      onvifEndpoint: onvifEndpoint.trim() || null,
      isPtz,
      resolution: resolution.trim() || null,
      fovDeg: fovDeg.trim() ? Number(fovDeg) : null,
      headingDeg: headingDeg.trim() ? Number(headingDeg) : null,
      // 비워두면 기존 자격을 그대로 둔다(undefined = 미변경). 조회 응답엔 절대 안 실려오므로
      // "지웠다"와 "안 건드렸다"를 구분할 수 없어, 명시적으로 입력했을 때만 반영한다.
      ...(onvifUsername.trim() ? { onvifUsername: onvifUsername.trim() } : {}),
      ...(onvifPassword.trim() ? { onvifPassword: onvifPassword.trim() } : {}),
    })
      .then((updated) => onSaved(updated))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.detail : "저장에 실패했습니다."))
      .finally(() => setSaving(false));
  };

  const handlePtzMove = () => {
    setPtzError(null);
    setPtzStatus(null);
    const body =
      ptzPan.trim() || ptzTilt.trim() || ptzZoom.trim()
        ? {
            ...(ptzPan.trim() ? { pan: Number(ptzPan) } : {}),
            ...(ptzTilt.trim() ? { tilt: Number(ptzTilt) } : {}),
            ...(ptzZoom.trim() ? { zoom: Number(ptzZoom) } : {}),
          }
        : null;
    if (!body) {
      setPtzError("pan/tilt/zoom 중 최소 하나는 입력해야 합니다.");
      return;
    }
    ptzMove(camera.deviceId, body)
      .then((res) => setPtzStatus(`명령 전송됨 (commandId=${res.commandId}, status=${res.status})`))
      .catch((err: unknown) => setPtzError(err instanceof ApiError ? err.detail : "PTZ 이동에 실패했습니다."));
  };

  const handlePtzStop = () => {
    setPtzError(null);
    setPtzStatus(null);
    ptzMove(camera.deviceId, { stop: true })
      .then((res) => setPtzStatus(`정지 명령 전송됨 (commandId=${res.commandId})`))
      .catch((err: unknown) => setPtzError(err instanceof ApiError ? err.detail : "PTZ 정지에 실패했습니다."));
  };

  const handleGotoPreset = (presetId: string) => {
    setPtzError(null);
    setPtzStatus(null);
    ptzGotoPreset(camera.deviceId, presetId)
      .then((res) => setPtzStatus(`프리셋 이동 명령 전송됨 (commandId=${res.commandId})`))
      .catch((err: unknown) => setPtzError(err instanceof ApiError ? err.detail : "프리셋 이동에 실패했습니다."));
  };

  const handleAddPreset = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!presetName.trim()) {
      setPresetError("프리셋 이름은 필수입니다.");
      return;
    }
    setPresetError(null);
    createCameraPreset(camera.deviceId, {
      name: presetName.trim(),
      pan: presetPan.trim() ? Number(presetPan) : null,
      tilt: presetTilt.trim() ? Number(presetTilt) : null,
      zoom: presetZoom.trim() ? Number(presetZoom) : null,
    })
      .then((preset) => {
        setPresets((prev) => [...prev, preset]);
        setPresetName("");
        setPresetPan("");
        setPresetTilt("");
        setPresetZoom("");
      })
      .catch((err: unknown) => setPresetError(err instanceof ApiError ? err.detail : "프리셋 추가에 실패했습니다."));
  };

  const handleAddCoverage = () => {
    if (!coverageAreaId) return;
    setCoverageError(null);
    addCameraCoverage(camera.deviceId, coverageAreaId).catch((err: unknown) =>
      setCoverageError(err instanceof ApiError ? err.detail : "커버리지 추가에 실패했습니다."),
    );
  };

  const handleRemoveCoverage = (areaId: string) => {
    setCoverageError(null);
    removeCameraCoverage(camera.deviceId, areaId).catch((err: unknown) =>
      setCoverageError(err instanceof ApiError ? err.detail : "커버리지 해제에 실패했습니다."),
    );
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h3>카메라 설정 — {camera.code}</h3>
        <div className="device-admin__form">
          <label>
            스트림 URL
            <input value={streamUrl} onChange={(e) => setStreamUrl(e.target.value)} />
          </label>
          {camera.protocol === "ONVIF" && (
            <>
              <label>
                ONVIF 엔드포인트
                <input value={onvifEndpoint} onChange={(e) => setOnvifEndpoint(e.target.value)} />
              </label>
              <label>
                ONVIF 사용자명(변경 시에만 입력)
                <input value={onvifUsername} onChange={(e) => setOnvifUsername(e.target.value)} autoComplete="off" />
              </label>
              <label>
                ONVIF 비밀번호(변경 시에만 입력)
                <input
                  type="password"
                  value={onvifPassword}
                  onChange={(e) => setOnvifPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
            </>
          )}
          <label>
            <input type="checkbox" checked={isPtz} onChange={(e) => setIsPtz(e.target.checked)} />
            PTZ 지원
          </label>
          <label>
            해상도
            <input value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="1920x1080" />
          </label>
          <label>
            화각(FOV, 도)
            <input value={fovDeg} onChange={(e) => setFovDeg(e.target.value)} placeholder="90" />
          </label>
          <label>
            설치 방향(heading, 도)
            <input value={headingDeg} onChange={(e) => setHeadingDeg(e.target.value)} placeholder="180" />
          </label>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="primary" onClick={handleSave} disabled={saving}>
            {saving ? "저장 중…" : "저장"}
          </button>
          <button type="button" onClick={onCancel}>
            닫기
          </button>
        </div>

        {isPtz && (
          <>
            <h4>PTZ 이동 테스트</h4>
            <p className="floor-map-admin__note">
              일반 기기 제어와 동일한 명령 흐름을 태운다(즉시 실행이 아니라 commandId를 돌려받고
              게이트웨이 카메라 어댑터가 비동기로 처리·ack한다). 라이브 뷰가 아직 없어 여기서는
              명령이 정상 접수됐는지(commandId/status)만 확인할 수 있다.
            </p>
            <div className="device-admin__form">
              <input value={ptzPan} onChange={(e) => setPtzPan(e.target.value)} placeholder="pan" />
              <input value={ptzTilt} onChange={(e) => setPtzTilt(e.target.value)} placeholder="tilt" />
              <input value={ptzZoom} onChange={(e) => setPtzZoom(e.target.value)} placeholder="zoom" />
              <button type="button" onClick={handlePtzMove}>
                이동
              </button>
              <button type="button" onClick={handlePtzStop}>
                정지
              </button>
            </div>
            {ptzError && <p className="error-text">{ptzError}</p>}
            {ptzStatus && <p className="success-text">{ptzStatus}</p>}

            <h4>PTZ 프리셋</h4>
            <ul className="floor-map-admin__note">
              {presets.map((preset) => (
                <li key={preset.id}>
                  {preset.name} (pan={preset.pan ?? "-"}, tilt={preset.tilt ?? "-"}, zoom={preset.zoom ?? "-"}){" "}
                  <button type="button" onClick={() => handleGotoPreset(preset.id)}>
                    이동
                  </button>
                </li>
              ))}
              {presets.length === 0 && <li>등록된 프리셋이 없습니다.</li>}
            </ul>
            <form className="device-admin__form" onSubmit={handleAddPreset}>
              <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="프리셋 이름" />
              <input value={presetPan} onChange={(e) => setPresetPan(e.target.value)} placeholder="pan" />
              <input value={presetTilt} onChange={(e) => setPresetTilt(e.target.value)} placeholder="tilt" />
              <input value={presetZoom} onChange={(e) => setPresetZoom(e.target.value)} placeholder="zoom" />
              <button type="submit">프리셋 추가</button>
            </form>
            {presetError && <p className="error-text">{presetError}</p>}
          </>
        )}

        <h4>커버 지역 (알람 현장확인 매핑)</h4>
        <div className="device-admin__form">
          <select value={coverageAreaId} onChange={(e) => setCoverageAreaId(e.target.value)}>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={handleAddCoverage} disabled={areas.length === 0}>
            커버리지 추가
          </button>
          {camera.areaId && (
            <button type="button" onClick={() => handleRemoveCoverage(camera.areaId as string)}>
              설치 지역({areas.find((a) => a.id === camera.areaId)?.name ?? camera.areaId}) 커버리지 해제
            </button>
          )}
        </div>
        {coverageError && <p className="error-text">{coverageError}</p>}
      </div>
    </div>
  );
}

export function CameraAdmin(): JSX.Element {
  const [areas, setAreas] = useState<AreaSummary[]>([]);
  const [cameras, setCameras] = useState<CameraSummaryType[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingCameraId, setEditingCameraId] = useState<string | null>(null);

  const reload = () => {
    listCameras()
      .then((result) => {
        setCameras(result);
        setLoadError(null);
      })
      .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.detail : "카메라 목록을 불러오지 못했습니다."));
  };

  useEffect(() => {
    listAreas()
      .then(setAreas)
      .catch(() => undefined);
    reload();
  }, []);

  const editingCamera = cameras.find((c) => c.deviceId === editingCameraId) ?? null;

  return (
    <div className="floor-map-admin">
      <h2>카메라 관리</h2>
      <p className="floor-map-admin__note">
        현장 확인용 카메라를 등록·관리합니다(architecture.md §5-cam). PTZ 프리셋과 커버 지역을
        매핑해두면 알람 발생 시 자동으로 현장을 비추는 데 쓰입니다.
      </p>

      {loadError && <p className="error-text">{loadError}</p>}

      <NewCameraForm areas={areas} onCreated={() => reload()} />

      <table className="floor-map-admin__table">
        <thead>
          <tr>
            <th>이름</th>
            <th>code</th>
            <th>설치 지역</th>
            <th>프로토콜</th>
            <th>PTZ</th>
            <th>스트림 URL</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          {cameras.map((camera) => (
            <tr key={camera.deviceId}>
              <td>{camera.name}</td>
              <td>{camera.code}</td>
              <td>{areas.find((a) => a.id === camera.areaId)?.name ?? "-"}</td>
              <td>{camera.protocol}</td>
              <td>{camera.isPtz ? "지원" : "-"}</td>
              <td>{camera.streamUrl}</td>
              <td>
                <button type="button" onClick={() => setEditingCameraId(camera.deviceId)}>
                  설정
                </button>
              </td>
            </tr>
          ))}
          {cameras.length === 0 && (
            <tr>
              <td colSpan={7} className="floor-map-admin__empty">
                등록된 카메라가 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editingCamera && (
        <CameraEditModal
          camera={editingCamera}
          areas={areas}
          onCancel={() => setEditingCameraId(null)}
          onSaved={() => {
            setEditingCameraId(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
