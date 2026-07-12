import { connect, publish, type DeviceIdentity, type MqttClient } from "@smarthome/mqtt";
import {
  CommandPayload,
  parseDeviceBase,
  qosFor,
  type AckPayload,
  type DeviceStatus,
  type StatePayload,
} from "@smarthome/contracts";

/**
 * 브로커 전역 목(mock) 응답기 — 모든 기기의 `/cmd`를 와일드카드로 받아
 * 표준 규약대로 `SUCCEEDED` ack + state(ON/OFF)를 대신 발행한다.
 *
 * 용도: 실기기/개별 시뮬레이터가 없는 데모 환경에서 (샘플 380기기 포함) 제어 명령이
 * 실제로 완료(SUCCEEDED)되고 화면 상태가 토글되도록 한다.
 *
 * 원칙:
 *  - **게이트웨이는 브리지 역할만** 유지한다. 기기 응답 위조는 전용 도구(시뮬레이터)에서만 한다.
 *  - contracts(AckPayload/StatePayload/CommandPayload) + mqtt(publish/topicFor)를 그대로 사용해
 *    게이트웨이 입장에서 실기기와 구분되지 않는다(QoS/retained 규칙 준수).
 *  - 멱등성: 동일 commandId 재수신 시 재실행 없이 기존 ack만 재전송.
 */
export class MockResponder {
  private client: MqttClient | undefined;
  private readonly processed = new Map<string, AckPayload>();

  constructor(private readonly url: string) {}

  start(): void {
    const client = connect(this.url, { clientId: `sim:mock-all-${process.pid}` });
    this.client = client;

    client.on("connect", () => {
      // cmd(7세그먼트)만 매칭 — cmd/ack(8세그먼트)·state 는 매칭되지 않아 루프가 없다.
      const sub = "enterprise/+/+/+/+/+/cmd";
      client.subscribe(sub, { qos: qosFor("cmd") });
      console.log(`[sim-mock] ${sub} 구독 — 모든 기기 cmd에 SUCCEEDED ack + state 응답(데모용)`);
    });
    client.on("message", (topic: string, payload: Buffer) => this.handle(topic, payload));
    client.on("error", (err: Error) => console.error(`[sim-mock] error: ${err.message}`));
  }

  private handle(topic: string, raw: Buffer): void {
    if (!topic.endsWith("/cmd")) return;
    const base = topic.slice(0, -"/cmd".length);
    const identity = parseDeviceBase(base);
    if (!identity) return;

    let json: unknown;
    try {
      json = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const parsed = CommandPayload.safeParse(json);
    if (!parsed.success) return;
    const cmd = parsed.data;

    // 멱등성: 이미 처리한 commandId면 재실행 없이 ack만 재전송.
    const seen = this.processed.get(cmd.commandId);
    if (seen) {
      this.sendAck(identity, seen);
      return;
    }

    const ack: AckPayload = {
      commandId: cmd.commandId,
      status: "SUCCEEDED",
      ts: Date.now(),
      deviceId: identity.device,
    };

    if (cmd.command === "turn_on") this.publishState(identity, "ON");
    else if (cmd.command === "turn_off") this.publishState(identity, "OFF");

    this.processed.set(cmd.commandId, ack);
    this.sendAck(identity, ack);
    console.log(`[sim-mock] ${identity.device} ${cmd.command}(${cmd.commandId}) → ack SUCCEEDED`);
  }

  private publishState(identity: DeviceIdentity, status: DeviceStatus): void {
    if (!this.client) return;
    const state: StatePayload = { status, ts: Date.now() };
    publish(this.client, identity, "state", state); // retained
  }

  private sendAck(identity: DeviceIdentity, ack: AckPayload): void {
    if (!this.client) return;
    publish(this.client, identity, "cmd/ack", ack);
  }

  async stop(): Promise<void> {
    const client = this.client;
    if (!client) return;
    await new Promise<void>((resolve) => {
      client.end(false, {}, () => resolve());
    });
  }
}
