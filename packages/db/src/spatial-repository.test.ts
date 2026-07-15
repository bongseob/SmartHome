import { describe, expect, it } from "vitest";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";
import {
  getAreaOverview,
  listAreasByFloor,
  listDevices,
  listFloors,
} from "./spatial-repository.js";

class FakeSpatialDb implements QueryExecutor {
  readonly statements: string[] = [];
  readonly params: unknown[][] = [];

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    this.statements.push(text);
    this.params.push(values ?? []);

    // device (FROM device) — device 분기를 최우선 검사
    if (text.includes("FROM device")) {
      if (values?.[0] && values[0] !== "area-1") return { rows: [], rowCount: 0 };
      return {
        rows: [
          {
            id: "dev-1",
            code: "light-01",
            name: "거실 조명",
            category: "DEVICE",
            device_role: "SENSOR",
            device_type: "light",
            manufacturer: null,
            model: null,
            firmware_version: null,
            mqtt_topic: "enterprise/site1/bldg-a/2f/living-room/light-01",
            current_status: "OFF",
            lifecycle_status: "ACTIVE",
            monitoring_visible: true,
            enabled: true,
            parent_device_id: null,
            sensor_signal_type: "DIGITAL",
            sensor_io_type: "DO",
            channel_address: "01",
            terminal_block: "A-2F-1",
            area_id: "area-1",
            area_topic_prefix: "enterprise/site1/bldg-a/2f/living-room",
            pos_x: "350",
            pos_y: "250",
            updated_at: new Date("2026-07-09T00:00:00.000Z"),
          } as unknown as T,
        ],
        rowCount: 1,
      };
    }

    // area (FROM area + JOIN floor/building/site[/image])
    if (text.includes("FROM area")) {
      // 단일 area 조회(a.id::text = $1)만 areaId로 필터한다. floor_id 필터(listAreasByFloor)는
      // 그대로 통과시킨다 — 이 페이크는 SQL을 파싱하지 않고 텍스트로만 분기한다.
      if (text.includes("a.id::text = $1") && values?.[0] && values[0] !== "area-1") {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [
          {
            id: "area-1",
            floor_id: "floor-1",
            name: "거실",
            slug: "living-room",
            area_slug: "living-room",
            polygon: [
              [100, 100],
              [500, 100],
              [500, 400],
              [100, 400],
            ],
            kind: "ROOM",
            image_id: null,
            image_url: null,
            image_width_px: null,
            image_height_px: null,
            pos_x: null,
            pos_y: null,
            floor_name: "2F",
            building_name: "Building A",
            building_slug: "bldg-a",
            site_name: "Site 1",
            site_slug: "site1",
            floor_slug: "2f",
          } as unknown as T,
        ],
        rowCount: 1,
      };
    }

    // floor (FROM floor f + JOIN building/site)
    if (text.includes("FROM floor f")) {
      return {
        rows: [
          {
            id: "floor-1",
            name: "2F",
            slug: "2f",
            floor_slug: "2f",
            building_name: "Building A",
            building_slug: "bldg-a",
            site_name: "Site 1",
            site_slug: "site1",
          } as unknown as T,
        ],
        rowCount: 1,
      };
    }

    return { rows: [], rowCount: 0 };
  }
}

describe("spatial repository", () => {
  it("listFloors — topicPrefix 포함", async () => {
    const db = new FakeSpatialDb();

    const floors = await listFloors(db);

    expect(floors).toHaveLength(1);
    const floor = floors[0]!;
    expect(floor.id).toBe("floor-1");
    expect(floor.topicPrefix).toBe("enterprise/site1/bldg-a/2f");
  });

  it("listAreasByFloor — polygon + topicPrefix 포함", async () => {
    const db = new FakeSpatialDb();

    const areas = await listAreasByFloor(db, "floor-1");

    expect(areas).toHaveLength(1);
    const area = areas[0]!;
    expect(area.slug).toBe("living-room");
    expect(area.topicPrefix).toBe("enterprise/site1/bldg-a/2f/living-room");
    expect(area.polygon).toEqual([
      [100, 100],
      [500, 100],
      [500, 400],
      [100, 400],
    ]);
  });

  it("listDevices — areaId 필터 + areaTopicPrefix 포함", async () => {
    const db = new FakeSpatialDb();

    const devices = await listDevices(db, { areaId: "area-1" });

    expect(devices).toHaveLength(1);
    const device = devices[0]!;
    expect(device.code).toBe("light-01");
    expect(device.areaTopicPrefix).toBe("enterprise/site1/bldg-a/2f/living-room");
    expect(db.params[0]).toContain("area-1");
  });

  it("listDevices — 필터 없이 전체 조회 시 WHERE 절 없음", async () => {
    const db = new FakeSpatialDb();

    await listDevices(db);

    expect(db.statements[0]).not.toContain("WHERE");
  });

  it("getAreaOverview — area가 없으면 null 반환", async () => {
    const db = new FakeSpatialDb();
    const overview = await getAreaOverview(db, "nonexistent-area");

    expect(overview).toBeNull();
  });

  it("getAreaOverview — area + 배경 이미지 + devices 반환, topicPrefix 채워짐", async () => {
    const db = new FakeSpatialDb();

    const overview = await getAreaOverview(db, "area-1");

    expect(overview).not.toBeNull();
    expect(overview?.area.id).toBe("area-1");
    expect(overview?.area.floorName).toBe("2F");
    expect(overview?.area.topicPrefix).toBe("enterprise/site1/bldg-a/2f/living-room");
    expect(overview?.devices).toHaveLength(1);
    expect(overview?.devices[0]?.code).toBe("light-01");
    expect(overview?.devices[0]?.areaTopicPrefix).toBe(
      "enterprise/site1/bldg-a/2f/living-room",
    );
  });
});
