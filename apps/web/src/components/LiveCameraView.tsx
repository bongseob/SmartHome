import { useEffect, useRef, useState } from "react";
import { ApiError, getCameraStream, listCameraPresets, ptzGotoPreset, ptzMove } from "../lib/api";
import type { CameraPresetRecord, CameraSummary } from "../lib/types";

interface LiveCameraViewProps {
  /** 알람 발생원을 커버하는 카메라 후보 목록(GET /alarms/:id/cameras) — 1개 이상. */
  cameras: CameraSummary[];
  initialCameraId?: string;
  onClose: () => void;
}

/**
 * WHEP(WebRTC-HTTP Egress Protocol)로 MediaMTX에 직접 붙어 라이브 영상을 재생한다
 * (architecture.md §5-cam — 영상은 api를 거치지 않고 media-gateway/MediaMTX가 직접 서빙).
 * 서명 토큰은 Authorization: Bearer 헤더로 실어 보낸다(mediamtx.org 문서 권장 방식).
 *
 * 브라우저 자동화 도구가 없는 환경에서 작성돼 실제 화면 재생은 눈으로 확인하지 못했다 —
 * WHEP 스펙(SDP offer/answer, ICE gathering 완료 후 단일 POST)대로 구현했고 인증 게이팅
 * 자체는 Phase 4에서 curl로 검증된 경로를 그대로 탄다.
 */
async function connectWhep(
  webrtcUrl: string,
  token: string,
  video: HTMLVideoElement,
): Promise<() => void> {
  const pc = new RTCPeerConnection();
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });
  pc.ontrack = (ev) => {
    if (video.srcObject !== ev.streams[0]) {
      video.srcObject = ev.streams[0] ?? null;
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Trickle ICE(PATCH로 후속 후보 전송) 대신, 후보 수집이 끝난 뒤 완전한 SDP를 한 번에 보낸다 —
  // WHEP 클라이언트 구현을 단순하게 유지(초기 연결 지연은 늘지만 로컬 mediamtx 기준 수백 ms 내).
  await new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve();
      return;
    }
    const check = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", check);
  });

  const response = await fetch(webrtcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/sdp",
      Authorization: `Bearer ${token}`,
    },
    body: pc.localDescription?.sdp ?? "",
  });
  if (!response.ok) {
    pc.close();
    throw new Error(`WHEP 연결 실패: HTTP ${response.status}`);
  }
  const answerSdp = await response.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  const location = response.headers.get("Location");
  const resourceUrl = location ? new URL(location, webrtcUrl).toString() : null;

  return () => {
    pc.close();
    if (resourceUrl) {
      void fetch(resourceUrl, { method: "DELETE" }).catch(() => undefined);
    }
  };
}

export function LiveCameraView({ cameras, initialCameraId, onClose }: LiveCameraViewProps): JSX.Element {
  const [selectedId, setSelectedId] = useState(initialCameraId ?? cameras[0]?.deviceId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [presets, setPresets] = useState<CameraPresetRecord[]>([]);
  const [ptzPan, setPtzPan] = useState("");
  const [ptzTilt, setPtzTilt] = useState("");
  const [ptzZoom, setPtzZoom] = useState("");
  const [ptzStatus, setPtzStatus] = useState<string | null>(null);

  const camera = cameras.find((c) => c.deviceId === selectedId) ?? null;
  // effect는 "어떤 카메라를 보는가"(deviceId)에만 반응해야 한다 — cameras 배열이 매 fetch마다
  // 새 객체 참조로 갱신돼도(같은 카메라라면) 재연결(화면 깜빡임)이 일어나면 안 되므로, camera
  // 객체 자체가 아니라 원시값(id/isPtz)만 뽑아 effect 안에서 참조한다(exhaustive-deps를
  // 억제가 아니라 실제로 만족시키는 구조).
  const cameraId = camera?.deviceId ?? null;
  const cameraIsPtz = camera?.isPtz ?? false;

  useEffect(() => {
    if (!cameraId) return;
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    setError(null);
    setConnecting(true);

    getCameraStream(cameraId)
      .then(({ webrtcUrl, token }) => {
        if (cancelled || !videoRef.current) return;
        return connectWhep(webrtcUrl, token, videoRef.current).then((stop) => {
          if (cancelled) {
            stop();
          } else {
            cleanup = stop;
          }
        });
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "스트림 연결에 실패했습니다."),
      )
      .finally(() => setConnecting(false));

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [cameraId]);

  useEffect(() => {
    if (!cameraId || !cameraIsPtz) {
      setPresets([]);
      return;
    }
    listCameraPresets(cameraId)
      .then(setPresets)
      .catch(() => setPresets([]));
  }, [cameraId, cameraIsPtz]);

  const handlePtzMove = () => {
    if (!camera) return;
    setPtzStatus(null);
    const body =
      ptzPan.trim() || ptzTilt.trim() || ptzZoom.trim()
        ? {
            ...(ptzPan.trim() ? { pan: Number(ptzPan) } : {}),
            ...(ptzTilt.trim() ? { tilt: Number(ptzTilt) } : {}),
            ...(ptzZoom.trim() ? { zoom: Number(ptzZoom) } : {}),
          }
        : null;
    if (!body) return;
    ptzMove(camera.deviceId, body)
      .then((res) => setPtzStatus(`이동 명령 전송됨 (${res.status})`))
      .catch((err: unknown) => setPtzStatus(err instanceof ApiError ? err.detail : "PTZ 이동 실패"));
  };

  const handlePtzStop = () => {
    if (!camera) return;
    ptzMove(camera.deviceId, { stop: true }).catch(() => undefined);
  };

  const handleGotoPreset = (presetId: string) => {
    if (!camera) return;
    setPtzStatus(null);
    ptzGotoPreset(camera.deviceId, presetId)
      .then((res) => setPtzStatus(`프리셋 이동 전송됨 (${res.status})`))
      .catch((err: unknown) => setPtzStatus(err instanceof ApiError ? err.detail : "프리셋 이동 실패"));
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h3>현장 확인{camera ? ` — ${camera.name}` : ""}</h3>

        {cameras.length > 1 && (
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {cameras.map((c) => (
              <option key={c.deviceId} value={c.deviceId}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        {cameras.length === 0 && <p className="error-text">이 알람을 커버하는 카메라가 없습니다.</p>}

        {camera && (
          <>
            {connecting && <p className="floor-map-admin__note">스트림 연결 중…</p>}
            {error && <p className="error-text">{error}</p>}
            <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", background: "#000" }} />

            {camera.isPtz && (
              <>
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
                {presets.length > 0 && (
                  <div className="device-admin__form">
                    {presets.map((preset) => (
                      <button key={preset.id} type="button" onClick={() => handleGotoPreset(preset.id)}>
                        {preset.name}
                      </button>
                    ))}
                  </div>
                )}
                {ptzStatus && <p className="success-text">{ptzStatus}</p>}
              </>
            )}
          </>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
