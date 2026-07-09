import { CameraProtocol } from "@smarthome/contracts";

/**
 * @smarthome/media-gateway — PTZ 카메라 영상 중계 (옵션, docs/architecture.md §5-cam).
 * RTSP 수신 → WebRTC/HLS 중계 + 단기 서명 URL. 영상은 MQTT 경유 금지.
 * TODO: RTSP 인제스트, WebRTC 시그널링, 서명 URL 발급.
 */
export function main(): void {
  console.log(
    `[media-gateway] 스캐폴딩 OK — 지원 프로토콜=${CameraProtocol.options.join(", ")}. 구현 예정.`,
  );
}

main();
