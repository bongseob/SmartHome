import {
  connect,
  offlineWill,
  publish,
  type DeviceIdentity,
  type MqttClient,
} from "@smarthome/mqtt";
import type { StatePayload, TelemetryPayload } from "@smarthome/contracts";

/** sine 텔레메트리 프로파일 (docs/device-simulator.md §6) */
export interface SineMetric {
  name: string;
  base: number;
  amp: number;
  periodS: number;
}

export interface VirtualDeviceConfig {
  identity: DeviceIdentity;
  telemetryIntervalMs?: number;
  metric?: SineMetric;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 가상 기기 (M1). contracts/mqtt 규약을 그대로 사용해 gateway 입장에서 실기기와 구분 불가.
 * 동작: connect(+LWT) → state ON(retained) → 주기 telemetry(QoS0).
 */
export class VirtualDevice {
  private client: MqttClient | undefined;
  private timer: NodeJS.Timeout | undefined;
  private startedAt = 0;

  constructor(
    private readonly url: string,
    private readonly cfg: VirtualDeviceConfig,
  ) {}

  get code(): string {
    return this.cfg.identity.device;
  }

  start(): void {
    this.startedAt = Date.now();
    const client = connect(this.url, {
      clientId: `sim:${this.cfg.identity.device}`,
      will: offlineWill(this.cfg.identity),
    });
    this.client = client;

    client.on("connect", () => {
      const state: StatePayload = { status: "ON", ts: Date.now() };
      publish(client, this.cfg.identity, "state", state); // retained
      console.log(`[sim] ${this.code} connected → state ON (retained)`);
      const interval = this.cfg.telemetryIntervalMs ?? 1000;
      this.timer = setInterval(() => this.emitTelemetry(), interval);
    });
    client.on("error", (err: Error) => {
      console.error(`[sim] ${this.code} error: ${err.message}`);
    });
  }

  private emitTelemetry(): void {
    if (!this.client) return;
    const metrics: Record<string, number> = {};
    const m = this.cfg.metric;
    if (m) {
      const t = (Date.now() - this.startedAt) / 1000;
      metrics[m.name] = round2(m.base + m.amp * Math.sin((2 * Math.PI * t) / m.periodS));
    }
    const payload: TelemetryPayload = { ts: Date.now(), metrics };
    publish(this.client, this.cfg.identity, "telemetry", payload);
    console.log(`[sim] ${this.code} telemetry ${JSON.stringify(metrics)}`);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    const client = this.client;
    if (!client) return;
    const offline: StatePayload = { status: "OFFLINE", ts: Date.now() };
    publish(client, this.cfg.identity, "state", offline);
    await new Promise<void>((resolve) => {
      client.end(false, {}, () => resolve());
    });
  }
}
