import { DeviceStatus } from "@smarthome/contracts";

/**
 * @smarthome/web — React + Konva 대시보드 (docs/ui-ux-design.md).
 * 현재는 스캐폴딩 플레이스홀더. TODO: Vite + React 부트스트랩, Floor Map(Konva),
 * MQTT over WebSocket 구독, 실행/편집 모드.
 */
export const DEVICE_STATUS_COLORS: Record<DeviceStatus, string> = {
  ON: "green",
  OFF: "gray",
  WARNING: "yellow",
  ALARM: "red",
  OFFLINE: "black",
};

console.log(
  `[web] 스캐폴딩 OK — 상태 색상 매핑=${Object.keys(DEVICE_STATUS_COLORS).join(", ")}. 구현 예정.`,
);
