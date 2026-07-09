import mqtt from "mqtt";
import type { IClientOptions, IClientPublishOptions, MqttClient } from "mqtt";
import {
  buildTopic,
  isRetained,
  qosFor,
  toUserProperties,
  type CommandUserProperties,
  type LwtPayload,
  type TopicSuffix,
} from "@smarthome/contracts";

/** 기기 UNS 좌표 (site/building/floor/area/device) */
export interface DeviceIdentity {
  site: string;
  building: string;
  floor: string;
  area: string;
  device: string;
}

export interface PublishOptions {
  qos: 0 | 1 | 2;
  retain: boolean;
}

/** QoS·Retained 규칙(PROJECT_RULES §3)을 contracts에서 파생 — 하드코딩 금지 */
export function publishOptionsFor(suffix: TopicSuffix): PublishOptions {
  return { qos: qosFor(suffix), retain: isRetained(suffix) };
}

export function topicFor(id: DeviceIdentity, suffix: TopicSuffix): string {
  return buildTopic({ ...id, suffix });
}

/**
 * LWT(Last Will) 구성 — 모든 기기 연결에 필수(SRS 4.1.2).
 * 비정상 종료 시 브로커가 `.../state` 에 OFFLINE(retained)을 게시한다.
 */
export function offlineWill(id: DeviceIdentity): IClientOptions["will"] {
  const payload: LwtPayload = { status: "OFFLINE", ts: Date.now() };
  return {
    topic: topicFor(id, "state"),
    payload: JSON.stringify(payload),
    qos: qosFor("state"),
    retain: true,
  };
}

/** MQTT5 클라이언트 연결 (LWT 등 옵션은 호출부에서 병합) */
export function connect(url: string, options: IClientOptions = {}): MqttClient {
  return mqtt.connect(url, { protocolVersion: 5, ...options });
}

/**
 * suffix 규칙(QoS/Retained)을 적용해 발행한다. 감사 메타데이터가 있으면
 * MQTT5 User Properties 로 싣는다(payload 중복 금지, SRS 4.3.3).
 */
export function publish(
  client: MqttClient,
  id: DeviceIdentity,
  suffix: TopicSuffix,
  payload: unknown,
  userProps?: CommandUserProperties,
): void {
  const { qos, retain } = publishOptionsFor(suffix);
  const opts: IClientPublishOptions = { qos, retain };
  if (userProps) {
    opts.properties = { userProperties: toUserProperties(userProps) };
  }
  client.publish(topicFor(id, suffix), JSON.stringify(payload), opts);
}

export type { MqttClient, IClientOptions } from "mqtt";
