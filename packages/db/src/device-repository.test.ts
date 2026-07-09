import { describe, expect, it } from "vitest";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";
import { getDeviceHistory, getDeviceState } from "./device-repository.js";

class FakeDeviceDb implements QueryExecutor {
  readonly statements: string[] = [];

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    this.statements.push(text);
    if (text.includes("FROM device")) {
      return {
        rows: [
          {
            id: "22222222-2222-2222-2222-222222222222",
            code: "thermostat-01",
            name: "Thermostat 01",
            category: "DEVICE",
            device_type: "thermostat",
            manufacturer: null,
            model: null,
            firmware_version: null,
            mqtt_topic: "enterprise/site/building/floor/room/thermostat-01",
            current_status: "ON",
            lifecycle_status: "ACTIVE",
            area_id: null,
            pos_x: null,
            pos_y: null,
            gateway_id: null,
            updated_at: new Date("2026-07-09T00:00:00.000Z"),
          } as unknown as T,
        ],
        rowCount: 1,
      };
    }
    if (text.includes("FROM command")) {
      return {
        rows: [
          {
            command_id: "CMD-1",
            session_id: "S-1",
            command: "set_temperature",
            status: "SUCCEEDED",
            mqtt_reason_code: 0,
            created_at: new Date("2026-07-09T00:00:01.000Z"),
            updated_at: new Date("2026-07-09T00:00:02.000Z"),
          } as unknown as T,
        ],
        rowCount: 1,
      };
    }
    if (text.includes("FROM audit_log") || text.includes("FROM alarm_log")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`unexpected query: ${text}`);
  }
}

describe("device repository", () => {
  it("maps device state rows to API-safe camelCase fields", async () => {
    const db = new FakeDeviceDb();

    const state = await getDeviceState(db, "thermostat-01");

    expect(state?.code).toBe("thermostat-01");
    expect(state?.currentStatus).toBe("ON");
    expect(state?.mqttTopic).toContain("thermostat-01");
  });

  it("returns command, audit, and alarm history buckets for a device", async () => {
    const db = new FakeDeviceDb();

    const history = await getDeviceHistory(db, "thermostat-01");

    expect(history?.device.id).toBe("22222222-2222-2222-2222-222222222222");
    expect(history?.commands[0]?.commandId).toBe("CMD-1");
    expect(db.statements.some((statement) => statement.includes("FROM audit_log"))).toBe(true);
    expect(db.statements.some((statement) => statement.includes("FROM alarm_log"))).toBe(true);
  });
});
