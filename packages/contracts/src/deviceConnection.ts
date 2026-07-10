import { z } from "zod";

/**
 * Device↔Gateway 연결 파라미터 (SRS 2.1.2·3.1.1). protocol별로 필요한 필드가 달라
 * discriminated union으로 정의한다 — DB에는 jsonb로 저장하되, API 경계에서는 이 스키마로 검증한다.
 */

const TcpIpConfig = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
});

const SerialConfig = z.object({
  comPort: z.string().min(1),
  baudRate: z.number().int().positive(),
  dataBits: z.number().int().min(5).max(8).optional(),
  parity: z.enum(["none", "even", "odd"]).optional(),
  stopBits: z.union([z.literal(1), z.literal(1.5), z.literal(2)]).optional(),
});

const ModbusTcpConfig = TcpIpConfig.extend({
  unitId: z.number().int().min(0).max(247),
});

const ModbusRtuConfig = SerialConfig.extend({
  unitId: z.number().int().min(0).max(247),
});

const ZigbeeConfig = z.object({
  panId: z.string().optional(),
  ieeeAddress: z.string().optional(),
  endpoint: z.number().int().optional(),
});

const ZwaveConfig = z.object({
  homeId: z.string().optional(),
  nodeId: z.number().int().optional(),
});

export const DeviceConnectionConfig = z.discriminatedUnion("protocol", [
  z.object({ protocol: z.literal("TCP_IP"), config: TcpIpConfig }),
  z.object({ protocol: z.literal("SERIAL"), config: SerialConfig }),
  z.object({ protocol: z.literal("MODBUS_TCP"), config: ModbusTcpConfig }),
  z.object({ protocol: z.literal("MODBUS_RTU"), config: ModbusRtuConfig }),
  z.object({ protocol: z.literal("ZIGBEE"), config: ZigbeeConfig }),
  z.object({ protocol: z.literal("ZWAVE"), config: ZwaveConfig }),
]);
export type DeviceConnectionConfig = z.infer<typeof DeviceConnectionConfig>;
