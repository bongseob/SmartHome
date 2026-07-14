import { readFileSync } from "node:fs";
import mqtt from "mqtt";
import type { IClientOptions, IClientPublishOptions, MqttClient } from "mqtt";
import {
  buildServiceStatusTopic,
  buildTopic,
  isRetained,
  qosFor,
  toUserProperties,
  type CommandUserProperties,
  type LwtPayload,
  type ServiceName,
  type ServiceStatusPayload,
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

/**
 * 서비스 프레즌스 LWT — 새 HTTP 포트를 열지 않고, 이미 맺고 있는 MQTT 연결이 비정상 종료되면
 * 브로커가 대신 OFFLINE(retained)을 게시하게 한다(기기 LWT와 동일한 패턴, SRS 4.1.2 참조).
 */
export function serviceWill(service: ServiceName): IClientOptions["will"] {
  const payload: ServiceStatusPayload = { service, status: "OFFLINE", ts: Date.now() };
  return {
    topic: buildServiceStatusTopic(service),
    payload: JSON.stringify(payload),
    qos: 1,
    retain: true,
  };
}

/** 정상 기동/종료 시 명시적으로 ONLINE·OFFLINE을 게시한다(LWT는 비정상 종료만 커버). */
export function publishServiceStatus(
  client: MqttClient,
  service: ServiceName,
  status: "ONLINE" | "OFFLINE",
): void {
  const payload: ServiceStatusPayload = { service, status, ts: Date.now() };
  client.publish(buildServiceStatusTopic(service), JSON.stringify(payload), { qos: 1, retain: true });
}

/**
 * MQTT5 클라이언트 연결 (LWT 등 옵션은 호출부에서 병합).
 * 브로커 인증(PROJECT_RULES §5) — MQTT_USERNAME/MQTT_PASSWORD가 있으면 자동으로 싣는다.
 * 백엔드 프로세스(api/gateway/scheduler/device-simulator)는 전부 이 함수를 통해서만
 * 연결하므로, 여기 한 곳만 고치면 모든 호출부에 계정이 적용된다 — 호출부가 명시적으로
 * username/password를 넘기면 그 값이 우선한다.
 *
 * TLS(mqtts, PROJECT_RULES §5.1) — MQTT_CA_FILE이 있으면 그 파일(사설 CA, 자체 서명)을
 * 신뢰 목록에 추가해 연결한다. dev(mqtt://, 평문)에서는 이 env가 없으니 그대로 무시된다.
 * 공인 CA로 발급받은 mqtts라면 MQTT_CA_FILE 없이 url만 mqtts://로 바꾸면 된다(mqtt.js가
 * Node 기본 신뢰 저장소를 쓴다).
 */
export function connect(url: string, options: IClientOptions = {}): MqttClient {
  const username = options.username ?? process.env.MQTT_USERNAME;
  const password = options.password ?? process.env.MQTT_PASSWORD;
  const caFile = process.env.MQTT_CA_FILE;
  const ca = options.ca ?? (caFile ? readFileSync(caFile) : undefined);
  return mqtt.connect(url, {
    protocolVersion: 5,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(ca ? { ca } : {}),
    ...options,
  });
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
