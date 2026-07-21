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
// 동기 재시도 횟수(총 시도 수). 순간적인 네트워크 흔들림은 여기서 흡수하고,
// 그래도 실패하면 호출자가 packages/db notification-repository로 배경 재시도에 넘긴다.
const SYNC_ATTEMPTS = 2;
const SYNC_RETRY_DELAY_MS = 1000;

export interface NotificationDispatchResult {
  success: boolean;
  /** 실패 시 마지막 시도의 에러 메시지. success=true면 없음. */
  error?: string;
  /** 동기 재시도까지 소진한 총 시도 횟수(배경 재시도 attempt_count의 시작값으로 쓴다). */
  attempts: number;
}

function extractWebhookUrl(config: unknown): string | null {
  if (typeof config === "object" && config !== null && "url" in config) {
    const url = (config as { url?: unknown }).url;
    return typeof url === "string" ? url : null;
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 실패 시 예외를 던진다 — 성공/실패를 호출자가 명시적으로 구분하게 한다(조용한 실패 금지). */
async function sendWebhookOnce(channel: NotificationChannelInput, url: string, payload: AlarmNotificationPayload): Promise<void> {
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
      throw new Error(`HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 채널 발송은 서로 독립적이어야 한다 — 한 채널의 실패/타임아웃이 알람 처리 전체를 막지 않는다.
 * 예전에는 실패를 로그만 남기고 성공처럼 resolve했다(코드 리뷰 P1 #11) — 화재/가스 같은
 * Reactive 알람 통지가 한 번의 네트워크 장애로 조용히 사라질 수 있었다. 이제 결과를
 * 명시적으로 반환하므로 호출자가 실패 시 notification_delivery에 기록해 배경 재시도로
 * 넘길 수 있다.
 */
export async function dispatchNotification(
  channel: NotificationChannelInput,
  payload: AlarmNotificationPayload,
): Promise<NotificationDispatchResult> {
  if (channel.type !== "WEBHOOK") {
    console.log(`[notify] (stub, provider 미정) ${channel.type} → '${channel.name}':`, payload);
    return { success: true, attempts: 1 };
  }

  const url = extractWebhookUrl(channel.config);
  if (!url) {
    const error = `webhook 채널 '${channel.name}'에 유효한 url 설정 없음`;
    console.warn(`[notify] ${error} — 스킵(재시도 안 함, 설정 문제라 재시도로 해결 안 됨)`);
    return { success: false, error, attempts: 1 };
  }

  let lastError = "unknown error";
  for (let attempt = 1; attempt <= SYNC_ATTEMPTS; attempt++) {
    try {
      await sendWebhookOnce(channel, url, payload);
      return { success: true, attempts: attempt };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[notify] 채널 '${channel.name}' 발송 실패(시도 ${attempt}/${SYNC_ATTEMPTS}):`, lastError);
      if (attempt < SYNC_ATTEMPTS) await delay(SYNC_RETRY_DELAY_MS);
    }
  }
  return { success: false, error: lastError, attempts: SYNC_ATTEMPTS };
}
