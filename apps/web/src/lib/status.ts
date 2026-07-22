import type { DeviceStatus, Severity } from "@smarthome/contracts";

/** docs/ui-ux-design.md §6.1 — 기기 상태 색상 (고정). */
export const DEVICE_STATUS_COLOR: Record<DeviceStatus, string> = {
  ON: "#2ecc71",
  OFF: "#95a5a6",
  WARNING: "#f1c40f",
  ALARM: "#e74c3c",
  OFFLINE: "#2c3e50",
};

/** docs/ui-ux-design.md §6.2 — 알람 severity 색상. */
export const SEVERITY_COLOR: Record<Severity, string> = {
  CRITICAL: "#e74c3c",
  WARNING: "#e67e22",
  INFO: "#7f8c8d",
};

/**
 * device_type별로 ON/OFF를 다른 말로 보여줘야 하는 센서의 라벨 오버라이드(2026-07-22 —
 * 화재안전문 DI 감지 센서: ON=열림, OFF=닫힘). currentStatus enum 자체(DEVICE_STATUS_COLOR와
 * 매핑되는 ON/OFF/WARNING/ALARM/OFFLINE)는 고정이라 바꾸지 않고, 화면에 보여줄 문자열만
 * device_type 기준으로 바꾼다 — 여기 없는 device_type은 원래 상태값을 그대로 보여준다.
 */
const STATUS_LABEL_OVERRIDE: Partial<Record<string, Partial<Record<DeviceStatus, string>>>> = {
  fire_door_sensor: { ON: "문열림", OFF: "문닫힘" },
};

export function deviceStatusLabel(status: DeviceStatus, deviceType?: string | null): string {
  return (deviceType && STATUS_LABEL_OVERRIDE[deviceType]?.[status]) || status;
}
