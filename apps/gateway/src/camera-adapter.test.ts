import { describe, expect, it, vi } from "vitest";
import type { QueryResultRow } from "@smarthome/db";
import type { MqttClient } from "@smarthome/mqtt";
import { CameraAdapter, parseOnvifEndpoint, type ConnectOnvif, type OnvifPtzClient } from "./camera-adapter.js";

const TOPIC = "enterprise/site1/bldg-a/2f/room/cam-01/cmd";

function commandPayload(command: string, args?: Record<string, unknown>): Buffer {
  return Buffer.from(
    JSON.stringify({
      sessionId: "S-1",
      commandId: "CMD-1",
      command,
      target: "cam-01",
      timestamp: Date.now(),
      ...(args ? { args } : {}),
    }),
  );
}

const DEVICE_ROW = {
  id: "dev-1",
  code: "cam-01",
  category: "CAMERA",
  device_role: "MONITORING_EQUIPMENT",
  simulated: false,
};

const ONVIF_CAMERA_ROW = {
  device_id: "dev-1",
  protocol: "ONVIF",
  stream_url: "rtsp://cam-ip/stream",
  onvif_endpoint: "http://cam-ip:8080/onvif/device_service",
  is_ptz: true,
  resolution: null,
  fov_deg: null,
  heading_deg: null,
  onvif_username: "admin",
  onvif_password: "secret",
};

const PRESET_ROW = {
  id: "preset-1",
  camera_id: "dev-1",
  name: "정문",
  pan: "10",
  tilt: "5",
  zoom: "1",
  created_by: null,
};

class FakeGatewayDb {
  constructor(
    private readonly device: Record<string, unknown> | null,
    private readonly camera: Record<string, unknown> | null,
    private readonly preset: Record<string, unknown> | null = null,
  ) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    if (text.includes("FROM device")) {
      return this.device ? { rows: [this.device as unknown as T], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (text.includes("FROM camera_preset")) {
      return this.preset ? { rows: [this.preset as unknown as T], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (text.includes("FROM camera WHERE")) {
      return this.camera ? { rows: [this.camera as unknown as T], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    throw new Error(`unexpected query: ${text}`);
  }
}

class FakeMqttClient {
  readonly published: Array<{ topic: string; payload: Record<string, unknown> }> = [];
  publish(topic: string, payload: string): void {
    this.published.push({ topic, payload: JSON.parse(payload) as Record<string, unknown> });
  }
}

function fakeOnvifClient() {
  return {
    relativeMove: vi.fn().mockResolvedValue(undefined),
    absoluteMove: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  } satisfies OnvifPtzClient;
}

describe("parseOnvifEndpoint", () => {
  it("호스트/포트/경로를 분해한다", () => {
    expect(parseOnvifEndpoint("http://192.168.1.50:8080/onvif/device_service")).toEqual({
      hostname: "192.168.1.50",
      port: 8080,
      path: "/onvif/device_service",
    });
  });
});

describe("CameraAdapter", () => {
  it("cmd가 아닌 토픽은 무시한다", async () => {
    const client = new FakeMqttClient();
    const onvif = fakeOnvifClient();
    const connectOnvif: ConnectOnvif = vi.fn().mockResolvedValue(onvif);
    const db = new FakeGatewayDb(DEVICE_ROW, ONVIF_CAMERA_ROW);
    const adapter = new CameraAdapter(client as unknown as MqttClient, connectOnvif, db);

    await adapter.handleMessage("enterprise/site1/bldg-a/2f/room/cam-01/cmd/ack", commandPayload("ptz_move", { pan: 1 }));

    expect(connectOnvif).not.toHaveBeenCalled();
    expect(client.published).toHaveLength(0);
  });

  it("ptz_move/ptz_goto_preset 이외의 명령은 무시한다(다른 기기 제어와 공유 구독이라 정상)", async () => {
    const client = new FakeMqttClient();
    const connectOnvif: ConnectOnvif = vi.fn().mockResolvedValue(fakeOnvifClient());
    const db = new FakeGatewayDb(DEVICE_ROW, ONVIF_CAMERA_ROW);
    const adapter = new CameraAdapter(client as unknown as MqttClient, connectOnvif, db);

    await adapter.handleMessage(TOPIC, commandPayload("turn_on"));

    expect(connectOnvif).not.toHaveBeenCalled();
    expect(client.published).toHaveLength(0);
  });

  it("device.simulated=true(실카메라 미연결)면 MockResponder에게 맡기고 건드리지 않는다", async () => {
    const client = new FakeMqttClient();
    const connectOnvif: ConnectOnvif = vi.fn().mockResolvedValue(fakeOnvifClient());
    const db = new FakeGatewayDb({ ...DEVICE_ROW, simulated: true }, ONVIF_CAMERA_ROW);
    const adapter = new CameraAdapter(client as unknown as MqttClient, connectOnvif, db);

    await adapter.handleMessage(TOPIC, commandPayload("ptz_move", { pan: 1 }));

    expect(connectOnvif).not.toHaveBeenCalled();
    expect(client.published).toHaveLength(0);
  });

  it("protocol!=ONVIF인 카메라는 처리하지 않는다(RTSP-only는 실행 방법이 없음)", async () => {
    const client = new FakeMqttClient();
    const connectOnvif: ConnectOnvif = vi.fn().mockResolvedValue(fakeOnvifClient());
    const db = new FakeGatewayDb(DEVICE_ROW, { ...ONVIF_CAMERA_ROW, protocol: "RTSP", onvif_endpoint: null });
    const adapter = new CameraAdapter(client as unknown as MqttClient, connectOnvif, db);

    await adapter.handleMessage(TOPIC, commandPayload("ptz_move", { pan: 1 }));

    expect(connectOnvif).not.toHaveBeenCalled();
    expect(client.published).toHaveLength(0);
  });

  it("category!=CAMERA인 기기는 무시한다", async () => {
    const client = new FakeMqttClient();
    const connectOnvif: ConnectOnvif = vi.fn().mockResolvedValue(fakeOnvifClient());
    const db = new FakeGatewayDb({ ...DEVICE_ROW, category: "DEVICE" }, ONVIF_CAMERA_ROW);
    const adapter = new CameraAdapter(client as unknown as MqttClient, connectOnvif, db);

    await adapter.handleMessage(TOPIC, commandPayload("ptz_move", { pan: 1 }));

    expect(connectOnvif).not.toHaveBeenCalled();
  });

  it("ptz_move {pan,tilt,zoom} → relativeMove 호출 + SUCCEEDED ack", async () => {
    const client = new FakeMqttClient();
    const onvif = fakeOnvifClient();
    const connectOnvif: ConnectOnvif = vi.fn().mockResolvedValue(onvif);
    const db = new FakeGatewayDb(DEVICE_ROW, ONVIF_CAMERA_ROW);
    const adapter = new CameraAdapter(client as unknown as MqttClient, connectOnvif, db);

    await adapter.handleMessage(TOPIC, commandPayload("ptz_move", { pan: 10, tilt: -5, zoom: 0 }));

    expect(connectOnvif).toHaveBeenCalledWith({
      hostname: "cam-ip",
      port: 8080,
      path: "/onvif/device_service",
      username: "admin",
      password: "secret",
    });
    expect(onvif.relativeMove).toHaveBeenCalledWith({ x: 10, y: -5, zoom: 0 });
    expect(client.published).toEqual([
      {
        topic: "enterprise/site1/bldg-a/2f/room/cam-01/cmd/ack",
        payload: expect.objectContaining({ commandId: "CMD-1", status: "SUCCEEDED", deviceId: "cam-01" }),
      },
    ]);
  });

  it("같은 commandId가 재전달되면 PTZ를 다시 실행하지 않고 캐시된 ack만 재발행한다(QoS1 redelivery 멱등성)", async () => {
    const client = new FakeMqttClient();
    const onvif = fakeOnvifClient();
    const connectOnvif: ConnectOnvif = vi.fn().mockResolvedValue(onvif);
    const db = new FakeGatewayDb(DEVICE_ROW, ONVIF_CAMERA_ROW);
    const adapter = new CameraAdapter(client as unknown as MqttClient, connectOnvif, db);
    const payload = commandPayload("ptz_move", { pan: 10, tilt: -5, zoom: 0 });

    await adapter.handleMessage(TOPIC, payload);
    await adapter.handleMessage(TOPIC, payload); // 재전달

    expect(onvif.relativeMove).toHaveBeenCalledTimes(1); // 물리 PTZ 호출은 한 번만
    expect(client.published).toHaveLength(2); // ack는 매번 재발행
    expect(client.published[1]?.payload).toMatchObject({ commandId: "CMD-1", status: "SUCCEEDED" });
  });

  it("실패한 commandId가 재전달되면 ONVIF를 다시 호출하지 않고 같은 FAILED ack를 재발행한다", async () => {
    const client = new FakeMqttClient();
    const connectOnvif: ConnectOnvif = vi.fn().mockRejectedValue(new Error("connection refused"));
    const db = new FakeGatewayDb(DEVICE_ROW, ONVIF_CAMERA_ROW);
    const adapter = new CameraAdapter(client as unknown as MqttClient, connectOnvif, db);
    const payload = commandPayload("ptz_move", { pan: 1 });

    await adapter.handleMessage(TOPIC, payload);
    await adapter.handleMessage(TOPIC, payload); // 재전달

    expect(connectOnvif).toHaveBeenCalledTimes(1);
    expect(client.published).toHaveLength(2);
    expect(client.published[1]?.payload).toMatchObject({ status: "FAILED", reasonCode: 0x80 });
  });

  it("ptz_move {stop:true} → stop 호출", async () => {
    const client = new FakeMqttClient();
    const onvif = fakeOnvifClient();
    const connectOnvif: ConnectOnvif = vi.fn().mockResolvedValue(onvif);
    const db = new FakeGatewayDb(DEVICE_ROW, ONVIF_CAMERA_ROW);
    const adapter = new CameraAdapter(client as unknown as MqttClient, connectOnvif, db);

    await adapter.handleMessage(TOPIC, commandPayload("ptz_move", { stop: true }));

    expect(onvif.stop).toHaveBeenCalledTimes(1);
    expect(onvif.relativeMove).not.toHaveBeenCalled();
    expect(client.published[0]?.payload).toMatchObject({ status: "SUCCEEDED" });
  });

  it("ptz_goto_preset → 저장된 pan/tilt/zoom으로 absoluteMove 호출", async () => {
    const client = new FakeMqttClient();
    const onvif = fakeOnvifClient();
    const connectOnvif: ConnectOnvif = vi.fn().mockResolvedValue(onvif);
    const db = new FakeGatewayDb(DEVICE_ROW, ONVIF_CAMERA_ROW, PRESET_ROW);
    const adapter = new CameraAdapter(client as unknown as MqttClient, connectOnvif, db);

    await adapter.handleMessage(TOPIC, commandPayload("ptz_goto_preset", { presetId: "preset-1" }));

    expect(onvif.absoluteMove).toHaveBeenCalledWith({ x: 10, y: 5, zoom: 1 });
    expect(client.published[0]?.payload).toMatchObject({ status: "SUCCEEDED" });
  });

  it("다른 카메라 소유의 presetId면 FAILED ack(reasonCode 포함)", async () => {
    const client = new FakeMqttClient();
    const connectOnvif: ConnectOnvif = vi.fn().mockResolvedValue(fakeOnvifClient());
    const db = new FakeGatewayDb(DEVICE_ROW, ONVIF_CAMERA_ROW, { ...PRESET_ROW, camera_id: "other-cam" });
    const adapter = new CameraAdapter(client as unknown as MqttClient, connectOnvif, db);

    await adapter.handleMessage(TOPIC, commandPayload("ptz_goto_preset", { presetId: "preset-1" }));

    expect(client.published[0]?.payload).toMatchObject({ status: "FAILED", reasonCode: 0x80 });
  });

  it("ONVIF 연결/호출이 실패하면 FAILED ack를 보낸다", async () => {
    const client = new FakeMqttClient();
    const connectOnvif: ConnectOnvif = vi.fn().mockRejectedValue(new Error("connection refused"));
    const db = new FakeGatewayDb(DEVICE_ROW, ONVIF_CAMERA_ROW);
    const adapter = new CameraAdapter(client as unknown as MqttClient, connectOnvif, db);

    await adapter.handleMessage(TOPIC, commandPayload("ptz_move", { pan: 1 }));

    expect(client.published[0]?.payload).toMatchObject({ status: "FAILED", reasonCode: 0x80 });
  });
});
