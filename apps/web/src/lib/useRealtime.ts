import { useEffect, useRef } from "react";
import { RealtimeEvent } from "@smarthome/contracts";
import { wsUrl } from "./api";

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

    const connect = (): void => {
      socket = new WebSocket(wsUrl());
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
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [enabled]);
}
