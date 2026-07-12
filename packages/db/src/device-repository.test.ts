import { describe, expect, it } from "vitest";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";
import { decommissionDevice, getAreaSlugPath, getDeviceHistory, getDeviceState } from "./device-repository.js";

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
            device_role: "SENSOR",
            device_type: "thermostat",
            manufacturer: null,
            model: null,
            firmware_version: null,
            mqtt_topic: "enterprise/site/building/floor/room/thermostat-01",
            current_status: "ON",
            lifecycle_status: "ACTIVE",
            monitoring_visible: true,
            enabled: true,
            parent_device_id: null,
            sensor_signal_type: "DIGITAL",
            sensor_io_type: "DI",
            channel_address: null,
            terminal_block: null,
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

  it("loads the canonical area slug path used to build UNS topics", async () => {
    const db: QueryExecutor = {
      async query<T extends QueryResultRow = QueryResultRow>(text: string) {
        expect(text).toContain("JOIN floor");
        return {
          rows: [{ site_slug: "site1", building_slug: "bldg-a", floor_slug: "2f", area_slug: "living-room" } as unknown as T],
          rowCount: 1,
        };
      },
    };

    await expect(getAreaSlugPath(db, "area-1")).resolves.toEqual({
      siteSlug: "site1",
      buildingSlug: "bldg-a",
      floorSlug: "2f",
      areaSlug: "living-room",
    });
  });

  it("decommissions instead of deleting the device", async () => {
    const db: QueryExecutor = {
      async query<T extends QueryResultRow = QueryResultRow>(text: string) {
        expect(text).toContain("lifecycle_status = 'DECOMMISSIONED'");
        expect(text).not.toContain("DELETE FROM device");
        return {
          rows: [{
            id: "device-1", code: "light-01", name: "Light", category: "DEVICE",
            device_role: "SENSOR", device_type: "light", manufacturer: null, model: null, firmware_version: null,
            mqtt_topic: "enterprise/site1/bldg-a/2f/living-room/light-01",
            current_status: "OFF", lifecycle_status: "DECOMMISSIONED",
            monitoring_visible: true, enabled: true, parent_device_id: null,
            sensor_signal_type: "DIGITAL", sensor_io_type: "DO", channel_address: null,
            terminal_block: null, area_id: "area-1",
            pos_x: null, pos_y: null, gateway_id: null, connection_protocol: null,
            connection_config: null, updated_at: new Date("2026-07-10T00:00:00.000Z"),
          } as unknown as T],
          rowCount: 1,
        };
      },
    };

    const device = await decommissionDevice(db, "device-1");
    expect(device?.lifecycleStatus).toBe("DECOMMISSIONED");
  });
});
