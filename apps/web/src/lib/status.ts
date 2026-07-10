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
