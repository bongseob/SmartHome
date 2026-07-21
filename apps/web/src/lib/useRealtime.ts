import { useEffect, useRef } from "react";
import { RealtimeEvent } from "@smarthome/contracts";
import { buildWsUrl } from "./api";

const RECONNECT_DELAY_MS = 3000;

/**
 * /ws/realtime 구독. 인증 만료(close code 4401)는 재연결하지 않고 onAuthExpired로 위임한다.
 * 그 외 종료는 일정 지연 후 재연결한다.
 */
export function useRealtime(
  enabled: boolean,
  onEvent: (event: RealtimeEvent) => void,
  onAuthExpired: () => void,
  onStatusChange?: (status: "connected" | "disconnected") => void,
): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onAuthExpiredRef = useRef(onAuthExpired);
  onAuthExpiredRef.current = onAuthExpired;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  useEffect(() => {
    if (!enabled) return;

    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    // ticket 발급(authedJson) 자체가 비동기 REST 호출이라 connect도 비동기가 됐다 — 발급을
    // 기다리는 사이 컴포넌트가 언마운트되거나 재연결 타이머가 또 돌 수 있으니 stopped를
    // await 뒤에 다시 확인한다(고아 WebSocket이 열리는 것을 방지).
    const connect = async (): Promise<void> => {
      let url: string;
      try {
        url = await buildWsUrl();
      } catch {
        if (stopped) return;
        onStatusChangeRef.current?.("disconnected");
        reconnectTimer = setTimeout(() => void connect(), RECONNECT_DELAY_MS);
        return;
      }
      if (stopped) return;

      socket = new WebSocket(url);
      socket.onopen = () => {
        onStatusChangeRef.current?.("connected");
      };
      socket.onmessage = (event: MessageEvent<string>) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }
        const result = RealtimeEvent.safeParse(parsed);
        if (result.success) {
          onEventRef.current(result.data);
        }
      };
      socket.onclose = (event: CloseEvent) => {
        onStatusChangeRef.current?.("disconnected");
        if (stopped) return;
        if (event.code === 4401) {
          onAuthExpiredRef.current();
          return;
        }
        reconnectTimer = setTimeout(() => void connect(), RECONNECT_DELAY_MS);
      };
    };

    void connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [enabled]);
}
