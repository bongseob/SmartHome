import type { ChannelType } from "@smarthome/contracts";

/**
 * 알람 Notification Channel 발송 단일 소스 (M9, PROJECT_RULES §8).
 * WEBHOOK만 실제 HTTP POST로 발송한다. PUSH/EMAIL/SMS는 provider가 아직 미정
 * (PROJECT_RULES 부록 A.2 열린 항목)이라 실제 발송 대신 로그 스텁만 남긴다 —
 * provider가 정해지면 이 스위치에 분기를 추가한다.
 */

export interface NotificationChannelInput {
  type: ChannelType;
  name: string;
  /** jsonb. WEBHOOK은 { url: string } 형태를 기대한다. */
  config: unknown;
}

export interface AlarmNotificationPayload {
  alarmId: string;
  tier: string;
  severity: string;
  message: string | null;
  deviceId: string | null;
  escalationLevel: number;
  ts: number;
}

const WEBHOOK_TIMEOUT_MS = 5000;

function extractWebhookUrl(config: unknown): string | null {
  if (typeof config === "object" && config !== null && "url" in config) {
    const url = (config as { url?: unknown }).url;
    return typeof url === "string" ? url : null;
  }
  return null;
}

async function sendWebhook(channel: NotificationChannelInput, payload: AlarmNotificationPayload): Promise<void> {
  const url = extractWebhookUrl(channel.config);
  if (!url) {
    console.warn(`[notify] webhook 채널 '${channel.name}'에 유효한 url 설정 없음 — 스킵`);
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: channel.name, ...payload }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error(`[notify] webhook '${channel.name}' 실패: HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** 채널 발송은 서로 독립적이어야 한다 — 한 채널의 실패/타임아웃이 알람 처리 전체를 막지 않는다. */
export async function dispatchNotification(
  channel: NotificationChannelInput,
  payload: AlarmNotificationPayload,
): Promise<void> {
  try {
    if (channel.type === "WEBHOOK") {
      await sendWebhook(channel, payload);
      return;
    }
    console.log(`[notify] (stub, provider 미정) ${channel.type} → '${channel.name}':`, payload);
  } catch (err) {
    console.error(`[notify] 채널 '${channel.name}' 발송 실패:`, err);
  }
}
