import { connect, publish, type DeviceIdentity, type MqttClient } from "@smarthome/mqtt";
import {
  CommandPayload,
  parseDeviceBase,
  qosFor,
  type AckPayload,
  type DeviceStatus,
  type StatePayload,
} from "@smarthome/contracts";
import { listSimulatedDeviceCodes, query } from "@smarthome/db";

const SIMULATED_REFRESH_MS = 30_000;
// 첫 simulated 목록 조회를 기다리는 상한(코드 리뷰 P2 #18) — DB가 느리거나 잠깐 안 붙어도
// 데모 환경에서 계속 쓸 수 있어야 하므로 무한정 기다리지는 않는다.
const STARTUP_LOOKUP_TIMEOUT_MS = 3000;

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
 *  - **device.simulated=false인 기기는 건드리지 않는다** — 실기기가 이미 그 기기의 cmd에
 *    직접 응답하므로, 여기서 함께 응답하면 retained state를 서로 덮어쓰는 경쟁이 생긴다.
 *    30초 주기로 DB의 simulated 목록을 새로 읽는다(알람 정책 캐시와 동일한 패턴). DB 조회가
 *    실패하면 이전 목록을 유지하고, 최초 조회 전(null)에는 안전하게 "전부 응답"으로 동작한다
 *    (DB 연결 없이도 기존처럼 쓸 수 있게 하는 fail-open — 이 도구는 데모/개발 편의용이라
 *    DB가 없는 순수 MQTT 환경에서도 그냥 켜지는 편이 낫다).
 */
export class MockResponder {
  private client: MqttClient | undefined;
  private readonly processed = new Map<string, AckPayload>();
  private simulatedCodes: Set<string> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly url: string) {}

  start(): void {
    const client = connect(this.url, { clientId: `sim:mock-all-${process.pid}` });
    this.client = client;

    client.on("message", (topic: string, payload: Buffer) => this.handle(topic, payload));
    client.on("error", (err: Error) => console.error(`[sim-mock] error: ${err.message}`));

    // 예전엔 connect 즉시 구독해서, 첫 simulated 목록 조회가 끝나기 전에 도착한 명령은
    // this.simulatedCodes===null인 fail-open 창에 걸려 무조건 응답했다(코드 리뷰 P2 #18 —
    // simulated=false인 실기기 명령까지 답할 위험). 첫 조회(또는 타임아웃)가 끝날 때까지
    // 구독 자체를 미뤄 그 창을 없앤다 — DB가 느리거나 없는 데모 환경은 타임아웃 후 기존과
    // 동일하게 fail-open으로 동작한다(문서화된 설계 의도 유지).
    const initialLookup = this.waitForInitialSimulatedCodes();
    client.on("connect", () => {
      void initialLookup.then(() => {
        // cmd(7세그먼트)만 매칭 — cmd/ack(8세그먼트)·state 는 매칭되지 않아 루프가 없다.
        const sub = "enterprise/+/+/+/+/+/cmd";
        client.subscribe(sub, { qos: qosFor("cmd") });
        console.log(`[sim-mock] ${sub} 구독 — 모든 기기 cmd에 SUCCEEDED ack + state 응답(데모용)`);
      });
    });

    this.refreshTimer = setInterval(() => void this.refreshSimulatedCodes(), SIMULATED_REFRESH_MS);
  }

  private waitForInitialSimulatedCodes(): Promise<void> {
    return Promise.race([
      this.refreshSimulatedCodes(),
      new Promise<void>((resolve) => setTimeout(resolve, STARTUP_LOOKUP_TIMEOUT_MS)),
    ]);
  }

  private async refreshSimulatedCodes(): Promise<void> {
    try {
      const codes = await listSimulatedDeviceCodes({ query });
      this.simulatedCodes = new Set(codes);
    } catch (err) {
      console.error(
        `[sim-mock] simulated 목록 조회 실패(DATABASE_URL 확인) — 이전 목록으로 계속: ${(err as Error).message}`,
      );
    }
  }

  private handle(topic: string, raw: Buffer): void {
    if (!topic.endsWith("/cmd")) return;
    const base = topic.slice(0, -"/cmd".length);
    const identity = parseDeviceBase(base);
    if (!identity) return;
    // simulated=false(실기기 연결됨)로 표시된 기기는 건드리지 않는다.
    if (this.simulatedCodes && !this.simulatedCodes.has(identity.device)) return;

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
    void publish(this.client, identity, "state", state); // retained
  }

  private sendAck(identity: DeviceIdentity, ack: AckPayload): void {
    if (!this.client) return;
    void publish(this.client, identity, "cmd/ack", ack);
  }

  async stop(): Promise<void> {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    const client = this.client;
    if (!client) return;
    await new Promise<void>((resolve) => {
      client.end(false, {}, () => resolve());
    });
  }
}
