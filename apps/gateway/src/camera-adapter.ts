import { Cam as OnvifCam } from "onvif";
import { CommandPayload, PtzGotoPresetArgs, PtzMoveArgs, parseDeviceBase, type AckPayload } from "@smarthome/contracts";
import { publish, type DeviceIdentity, type MqttClient } from "@smarthome/mqtt";
import {
  getCameraByDeviceId,
  getCameraPresetById,
  getDeviceState,
  query,
  type QueryExecutor,
} from "@smarthome/db";

export interface OnvifPtzClient {
  relativeMove(vector: { x: number; y: number; zoom: number }): Promise<void>;
  absoluteMove(vector: { x: number; y: number; zoom: number }): Promise<void>;
  stop(): Promise<void>;
}

export interface ConnectOnvifOptions {
  hostname: string;
  port?: number | undefined;
  path?: string | undefined;
  username?: string | undefined;
  password?: string | undefined;
}

export type ConnectOnvif = (opts: ConnectOnvifOptions) => Promise<OnvifPtzClient>;

/**
 * 실제 ONVIF SOAP 호출 — `onvif` 패키지(콜백 API, onvif.d.ts 참고)를 Promise로 감싼다.
 * 테스트에서는 이 함수 대신 가짜 OnvifPtzClient를 주입해 실카메라 없이 CameraAdapter의
 * 라우팅/변환 로직만 검증한다(CameraAdapter 생성자의 connectOnvif 파라미터).
 */
export const connectOnvifCam: ConnectOnvif = (opts) =>
  new Promise((resolve, reject) => {
    const cam = new OnvifCam(
      {
        hostname: opts.hostname,
        port: opts.port,
        path: opts.path,
        username: opts.username,
        password: opts.password,
      },
      function onConnected(this: OnvifCam, err) {
        if (err) {
          reject(err);
          return;
        }
        const client: OnvifPtzClient = {
          relativeMove: (v) =>
            new Promise<void>((res, rej) => cam.relativeMove(v, (e) => (e ? rej(e) : res()))),
          absoluteMove: (v) =>
            new Promise<void>((res, rej) => cam.absoluteMove(v, (e) => (e ? rej(e) : res()))),
          stop: () =>
            new Promise<void>((res, rej) =>
              cam.stop({ panTilt: true, zoom: true }, (e) => (e ? rej(e) : res())),
            ),
        };
        resolve(client);
      },
    );
  });

/** camera.onvif_endpoint(예: http://cam-ip/onvif/device_service)를 Cam 생성자 옵션으로 분해한다. */
export function parseOnvifEndpoint(
  endpoint: string,
): { hostname: string; port?: number | undefined; path?: string | undefined } {
  const url = new URL(endpoint);
  return {
    hostname: url.hostname,
    port: url.port ? Number(url.port) : undefined,
    path: url.pathname || undefined,
  };
}

/**
 * 카메라 PTZ 어댑터(architecture.md §5-cam) — `category=CAMERA`·`protocol=ONVIF`·
 * `device.simulated=false`(실카메라 연결됨)인 기기의 `ptz_move`/`ptz_goto_preset` 명령을
 * 실제 ONVIF 호출로 변환하고 표준 ack(cmd/ack)를 발행한다.
 *
 * - `device.simulated=true`(기본값·실카메라 미연결)는 건드리지 않는다 — device-simulator의
 *   MockResponder가 대신 SUCCEEDED ack를 보낸다(실기기 온보딩 시 simulated=false로 전환하는
 *   기존 관례와 동일, mock-responder.ts 참고). 두 응답자가 동시에 같은 명령에 ack하면 경쟁이 생긴다.
 * - `protocol!=ONVIF`인 카메라(RTSP-only 등)는 PTZ를 실행할 방법이 없어 그냥 지나친다 —
 *   ack가 안 오면 결국 command-flow의 타임아웃 워커가 TIMED_OUT으로 종결한다(§mqtt-command).
 * - 우리 `camera_preset`은 ONVIF 자체 프리셋 토큰이 아니라 pan/tilt/zoom 절대값을 저장하므로
 *   `ptz_goto_preset`은 ONVIF의 GotoPreset이 아니라 AbsoluteMove로 변환한다.
 */
interface CachedAckResult {
  status: "SUCCEEDED" | "FAILED";
  reasonCode?: number;
}

// MQTT QoS1 redelivery(브로커 재연결·PUBACK 유실 등)로 같은 commandId가 두 번 오면 PTZ를 다시
// 실행하지 않고 캐시된 ack만 재발행한다(코드 리뷰 P1 #7 — 상대이동 PTZ는 중복 실행 시 실제
// 위치가 달라진다). 프로세스 생애 동안 무한정 자라지 않도록 오래된 항목부터 밀어낸다.
const MAX_DEDUP_ENTRIES = 500;

export class CameraAdapter {
  private readonly processedCommands = new Map<string, CachedAckResult>();

  constructor(
    private readonly client: MqttClient,
    private readonly connectOnvif: ConnectOnvif = connectOnvifCam,
    private readonly db: QueryExecutor = { query },
  ) {}

  private recordProcessed(commandId: string, result: CachedAckResult): void {
    this.processedCommands.set(commandId, result);
    if (this.processedCommands.size > MAX_DEDUP_ENTRIES) {
      const oldestKey = this.processedCommands.keys().next().value;
      if (oldestKey !== undefined) this.processedCommands.delete(oldestKey);
    }
  }

  async handleMessage(topic: string, raw: Buffer): Promise<void> {
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
    if (cmd.command !== "ptz_move" && cmd.command !== "ptz_goto_preset") return;

    const cached = this.processedCommands.get(cmd.commandId);
    if (cached) {
      if (cached.status === "SUCCEEDED") {
        this.ack(identity, cmd.commandId, "SUCCEEDED");
      } else {
        this.ack(identity, cmd.commandId, "FAILED", cached.reasonCode ?? 0x80);
      }
      console.log(
        `[gateway] camera-adapter ${identity.device} ${cmd.command}(${cmd.commandId}) 중복 수신 — PTZ 재실행 없이 ack만 재발행`,
      );
      return;
    }

    const device = await getDeviceState(this.db, identity.device);
    if (!device || device.category !== "CAMERA") return;
    if (device.simulated) return; // MockResponder가 담당(실카메라 미연결)

    const camera = await getCameraByDeviceId(this.db, device.id);
    if (!camera || camera.protocol !== "ONVIF" || !camera.onvifEndpoint) return; // 이 어댑터가 다룰 대상 아님

    try {
      const onvif = await this.connectOnvif({
        ...parseOnvifEndpoint(camera.onvifEndpoint),
        username: camera.onvifUsername ?? undefined,
        password: camera.onvifPassword ?? undefined,
      });

      if (cmd.command === "ptz_move") {
        const args = PtzMoveArgs.parse(cmd.args ?? {});
        if ("stop" in args) {
          await onvif.stop();
        } else {
          await onvif.relativeMove({ x: args.pan ?? 0, y: args.tilt ?? 0, zoom: args.zoom ?? 0 });
        }
      } else {
        const args = PtzGotoPresetArgs.parse(cmd.args ?? {});
        const preset = await getCameraPresetById(this.db, args.presetId);
        if (!preset || preset.cameraId !== device.id) {
          throw new Error(`preset not found for camera: ${args.presetId}`);
        }
        await onvif.absoluteMove({ x: preset.pan ?? 0, y: preset.tilt ?? 0, zoom: preset.zoom ?? 0 });
      }

      this.ack(identity, cmd.commandId, "SUCCEEDED");
      this.recordProcessed(cmd.commandId, { status: "SUCCEEDED" });
      console.log(`[gateway] camera-adapter ${identity.device} ${cmd.command}(${cmd.commandId}) → SUCCEEDED`);
    } catch (err) {
      console.error(`[gateway] camera-adapter PTZ 실패 device=${identity.device} command=${cmd.commandId}:`, err);
      const reasonCode = 0x80; // Unspecified error(MQTT5 reason code)
      this.ack(identity, cmd.commandId, "FAILED", reasonCode);
      this.recordProcessed(cmd.commandId, { status: "FAILED", reasonCode });
    }
  }

  private ack(identity: DeviceIdentity, commandId: string, status: "SUCCEEDED", reasonCode?: undefined): void;
  private ack(identity: DeviceIdentity, commandId: string, status: "FAILED", reasonCode: number): void;
  private ack(identity: DeviceIdentity, commandId: string, status: "SUCCEEDED" | "FAILED", reasonCode?: number): void {
    const ack: AckPayload = {
      commandId,
      status,
      ts: Date.now(),
      deviceId: identity.device,
      ...(reasonCode !== undefined ? { reasonCode } : {}),
    };
    void publish(this.client, identity, "cmd/ack", ack);
  }
}
