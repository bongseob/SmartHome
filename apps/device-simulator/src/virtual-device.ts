import {
  connect,
  offlineWill,
  publish,
  topicFor,
  type DeviceIdentity,
  type MqttClient,
} from "@smarthome/mqtt";
import {
  CommandPayload,
  qosFor,
  type AckPayload,
  type DeviceStatus,
  type StatePayload,
  type TelemetryPayload,
} from "@smarthome/contracts";

/** sine 텔레메트리 프로파일 (docs/device-simulator.md §6) */
export interface SineMetric {
  name: string;
  base: number;
  amp: number;
  periodS: number;
}

/** 명령 결함 주입 (docs/device-simulator.md §7) */
export interface CommandFault {
  /** 대상 command 이름 (예: "turn_off") */
  command: string;
  /** FAILED: reasonCode와 함께 실패 ack / NO_ACK: ack 미발행 → TIMED_OUT 경로 검증 */
  behavior: "FAILED" | "NO_ACK";
  reasonCode?: number;
}

export interface VirtualDeviceConfig {
  identity: DeviceIdentity;
  telemetryIntervalMs?: number;
  metric?: SineMetric;
  /** ack 응답 지연(ms) — SLA 경계 테스트용 */
  ackDelayMs?: number;
  faults?: CommandFault[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 가상 기기 (M2). contracts/mqtt 규약을 그대로 사용해 gateway 입장에서 실기기와 구분 불가.
 * 동작: connect(+LWT) → state ON(retained) → 주기 telemetry(QoS0)
 *      + /cmd 구독 → 멱등성 검사 → 처리 → /cmd/ack (결함 주입 지원).
 */
export class VirtualDevice {
  private client: MqttClient | undefined;
  private timer: NodeJS.Timeout | undefined;
  private startedAt = 0;
  private status: DeviceStatus = "ON";
  /** 처리한 commandId → 최종 ack (동일 commandId 재수신 시 재실행 금지, ack 재전송) */
  private readonly processed = new Map<string, AckPayload>();

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
      this.publishState("ON");
      console.log(`[sim] ${this.code} connected → state ON (retained)`);
      // 자신의 /cmd 구독 (QoS1)
      const cmdTopic = topicFor(this.cfg.identity, "cmd");
      client.subscribe(cmdTopic, { qos: qosFor("cmd") });
      const interval = this.cfg.telemetryIntervalMs ?? 1000;
      // 브로커 재연결마다 이 콜백이 다시 실행된다 — 이전 인터벌을 정리하지 않고 그냥 덮어쓰면
      // 예전 인터벌이 참조를 잃은 채 계속 돌아 재연결이 반복될수록 telemetry가 중복 발행되고
      // 인터벌이 누적됐다(코드 리뷰 P2 #19).
      if (this.timer) clearInterval(this.timer);
      this.timer = setInterval(() => this.emitTelemetry(), interval);
    });
    client.on("message", (topic: string, payload: Buffer) => {
      if (topic === topicFor(this.cfg.identity, "cmd")) {
        this.handleCommand(payload);
      }
    });
    client.on("error", (err: Error) => {
      console.error(`[sim] ${this.code} error: ${err.message}`);
    });
  }

  private publishState(status: DeviceStatus): void {
    if (!this.client) return;
    this.status = status;
    const state: StatePayload = { status, ts: Date.now() };
    publish(this.client, this.cfg.identity, "state", state); // retained
  }

  private handleCommand(raw: Buffer): void {
    let json: unknown;
    try {
      json = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const parsed = CommandPayload.safeParse(json);
    if (!parsed.success) {
      console.warn(`[sim] ${this.code} 잘못된 cmd payload — 무시`);
      return;
    }
    const cmd = parsed.data;
    if (cmd.target !== this.code) return; // 다른 기기 대상

    // 멱등성: 동일 commandId 재수신 시 재실행 금지, 기존 ack 재전송
    const seen = this.processed.get(cmd.commandId);
    if (seen) {
      console.log(`[sim] ${this.code} duplicate ${cmd.commandId} → ack 재전송(재실행 없음)`);
      this.sendAck(seen);
      return;
    }

    const fault = this.cfg.faults?.find((f) => f.command === cmd.command);
    if (fault?.behavior === "NO_ACK") {
      console.warn(`[sim] ${this.code} ${cmd.command} → 결함주입 NO_ACK (TIMED_OUT 유도)`);
      return; // ack 없이 침묵 → 서버 스위퍼가 TIMED_OUT 처리해야 함
    }

    const ack: AckPayload =
      fault?.behavior === "FAILED"
        ? {
            commandId: cmd.commandId,
            status: "FAILED",
            reasonCode: fault.reasonCode ?? 128,
            ts: Date.now(),
            deviceId: this.code,
          }
        : {
            commandId: cmd.commandId,
            status: "SUCCEEDED",
            ts: Date.now(),
            deviceId: this.code,
          };

    // 성공 시 상태 반영 (turn_on/turn_off), query_state는 상태 변경 없이 현재 상태만 재발행
    if (ack.status === "SUCCEEDED") {
      if (cmd.command === "turn_on") this.publishState("ON");
      else if (cmd.command === "turn_off") this.publishState("OFF");
      else if (cmd.command === "query_state") this.publishState(this.status);
    }

    this.processed.set(cmd.commandId, ack);
    const delay = this.cfg.ackDelayMs ?? 0;
    if (delay > 0) {
      setTimeout(() => this.sendAck(ack), delay);
    } else {
      this.sendAck(ack);
    }
    console.log(`[sim] ${this.code} ${cmd.command}(${cmd.commandId}) → ack ${ack.status}`);
  }

  private sendAck(ack: AckPayload): void {
    if (!this.client) return;
    publish(this.client, this.cfg.identity, "cmd/ack", ack);
  }

  private emitTelemetry(): void {
    if (!this.client || this.status === "OFF") return;
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
