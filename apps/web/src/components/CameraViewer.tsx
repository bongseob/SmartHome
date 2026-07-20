import { useEffect, useState } from "react";
import { ApiError, listCameras } from "../lib/api";
import type { CameraSummary } from "../lib/types";
import { LiveCameraView } from "./LiveCameraView";

/**
 * 알람과 무관하게 등록된 카메라를 둘러보고 라이브 영상을 확인하는 화면(§5-cam).
 * 목록 조회·스트림 발급 모두 VIEW 권한이면 되므로(카메라 등록/설정 같은 ADMIN 전용
 * "카메라 관리"와 달리) 로그인한 모든 사용자에게 노출한다.
 */
export function CameraViewer(): JSX.Element {
  const [cameras, setCameras] = useState<CameraSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  useEffect(() => {
    listCameras()
      .then(setCameras)
      .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.detail : "카메라 목록을 불러오지 못했습니다."));
  }, []);

  return (
    <div className="floor-map-admin">
      <h2>카메라</h2>
      <p className="floor-map-admin__note">등록된 카메라의 실시간 영상을 확인합니다.</p>

      {loadError && <p className="error-text">{loadError}</p>}

      <table className="floor-map-admin__table">
        <thead>
          <tr>
            <th>이름</th>
            <th>프로토콜</th>
            <th>PTZ</th>
            <th>상태</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {cameras.map((camera) => (
            <tr key={camera.deviceId}>
              <td>{camera.name}</td>
              <td>{camera.protocol}</td>
              <td>{camera.isPtz ? "지원" : "-"}</td>
              <td>{camera.currentStatus}</td>
              <td>
                <button type="button" onClick={() => setViewingId(camera.deviceId)}>
                  보기
                </button>
              </td>
            </tr>
          ))}
          {cameras.length === 0 && !loadError && (
            <tr>
              <td colSpan={5} className="floor-map-admin__empty">
                등록된 카메라가 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {viewingId && (
        <LiveCameraView cameras={cameras} initialCameraId={viewingId} onClose={() => setViewingId(null)} />
      )}
    </div>
  );
}
