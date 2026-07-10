import type { RealtimeEvent } from "@smarthome/contracts";
import { SEVERITY_COLOR } from "../lib/status";

export interface FeedEntry {
  key: string;
  event: RealtimeEvent;
}

function describe(event: RealtimeEvent): { text: string; color?: string } {
  switch (event.type) {
    case "device.state":
      return { text: `${event.deviceCode} → ${event.status}` };
    case "command.status":
      return { text: `명령 ${event.commandId.slice(0, 12)}… → ${event.status}` };
    case "alarm.raised":
      return {
        text: `[${event.tier}] ${event.message ?? event.severity}`,
        color: SEVERITY_COLOR[event.severity],
      };
    default:
      return { text: "알 수 없는 이벤트" };
  }
}

interface EventFeedProps {
  entries: FeedEntry[];
}

export function EventFeed({ entries }: EventFeedProps): JSX.Element {
  return (
    <section className="event-feed">
      <h3>실시간 타임라인</h3>
      <ul>
        {entries.map(({ key, event }) => {
          const { text, color } = describe(event);
          return (
            <li key={key} style={color ? { color } : undefined}>
              <time>{new Date(event.ts).toLocaleTimeString()}</time> {text}
            </li>
          );
        })}
        {entries.length === 0 && <li className="event-feed__empty">아직 이벤트가 없습니다.</li>}
      </ul>
    </section>
  );
}
