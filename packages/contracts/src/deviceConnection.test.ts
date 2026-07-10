import { describe, expect, it } from "vitest";
import { DeviceConnectionConfig } from "./deviceConnection.js";

describe("DeviceConnectionConfig", () => {
  it("TCP_IP: host/port면 통과", () => {
    const ok = DeviceConnectionConfig.safeParse({
      protocol: "TCP_IP",
      config: { host: "192.168.0.10", port: 502 },
    });
    expect(ok.success).toBe(true);
  });

  it("SERIAL: comPort/baudRate면 통과", () => {
    const ok = DeviceConnectionConfig.safeParse({
      protocol: "SERIAL",
      config: { comPort: "COM3", baudRate: 9600 },
    });
    expect(ok.success).toBe(true);
  });

  it("MODBUS_TCP: host/port에 unitId까지 필요", () => {
    const missingUnitId = DeviceConnectionConfig.safeParse({
      protocol: "MODBUS_TCP",
      config: { host: "10.0.0.5", port: 502 },
    });
    expect(missingUnitId.success).toBe(false);

    const ok = DeviceConnectionConfig.safeParse({
      protocol: "MODBUS_TCP",
      config: { host: "10.0.0.5", port: 502, unitId: 1 },
    });
    expect(ok.success).toBe(true);
  });

  it("MODBUS_RTU: comPort/baudRate에 unitId까지 필요", () => {
    const ok = DeviceConnectionConfig.safeParse({
      protocol: "MODBUS_RTU",
      config: { comPort: "COM4", baudRate: 19200, unitId: 5 },
    });
    expect(ok.success).toBe(true);
  });

  it("ZIGBEE/ZWAVE: 필드는 전부 선택값이라 빈 config도 통과", () => {
    expect(
      DeviceConnectionConfig.safeParse({ protocol: "ZIGBEE", config: {} }).success,
    ).toBe(true);
    expect(
      DeviceConnectionConfig.safeParse({ protocol: "ZWAVE", config: {} }).success,
    ).toBe(true);
  });

  it("protocol과 config 모양이 안 맞으면(TCP_IP인데 comPort) 실패", () => {
    const bad = DeviceConnectionConfig.safeParse({
      protocol: "TCP_IP",
      config: { comPort: "COM1", baudRate: 9600 },
    });
    expect(bad.success).toBe(false);
  });

  it("정의되지 않은 protocol은 실패", () => {
    const bad = DeviceConnectionConfig.safeParse({
      protocol: "BLUETOOTH",
      config: {},
    });
    expect(bad.success).toBe(false);
  });
});
