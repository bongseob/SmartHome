import { describe, expect, it } from "vitest";
import type { QueryResultRow } from "./pool.js";
import type { QueryExecutor } from "./audit-repository.js";
import {
  addCameraCoverage,
  createCameraPreset,
  getCameraByDeviceId,
  getCameraSummaryByDeviceId,
  insertCamera,
  listCameraCoverageAreaIds,
  listCameraPresets,
  listCameras,
  removeCameraCoverage,
  updateCamera,
} from "./camera-repository.js";

const CAMERA_ROW = {
  device_id: "cam-1",
  protocol: "RTSP",
  stream_url: "rtsp://mediamtx:8554/cam-01",
  onvif_endpoint: null,
  is_ptz: true,
  resolution: "1280x720",
  fov_deg: "90",
  heading_deg: "180",
  onvif_username: null,
  onvif_password: null,
};

class FakeCameraDb implements QueryExecutor {
  readonly statements: string[] = [];
  readonly params: unknown[][] = [];

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    this.statements.push(text);
    this.params.push(values ?? []);

    if (text.includes("INSERT INTO camera_coverage") || text.includes("DELETE FROM camera_coverage")) {
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("SELECT area_id::text FROM camera_coverage")) {
      return { rows: [{ area_id: "area-1" } as unknown as T], rowCount: 1 };
    }
    if (text.includes("INSERT INTO camera_preset")) {
      return {
        rows: [
          {
            id: "preset-1",
            camera_id: "cam-1",
            name: "정문",
            pan: "0",
            tilt: "10",
            zoom: "1",
            created_by: "admin-1",
          } as unknown as T,
        ],
        rowCount: 1,
      };
    }
    if (text.includes("FROM camera_preset")) {
      return {
        rows: [
          { id: "preset-1", camera_id: "cam-1", name: "정문", pan: null, tilt: null, zoom: null, created_by: null } as unknown as T,
        ],
        rowCount: 1,
      };
    }
    if (text.includes("FROM camera c")) {
      return {
        rows: [
          {
            device_id: "cam-1",
            code: "cam-01",
            name: "정문 카메라",
            current_status: "ON",
            area_id: "area-1",
            area_topic_prefix: "enterprise/site1/bldg-a/1f/lobby",
            protocol: "RTSP",
            stream_url: "rtsp://mediamtx:8554/cam-01",
            onvif_endpoint: null,
            is_ptz: true,
            resolution: "1280x720",
            fov_deg: "90",
            heading_deg: "180",
          } as unknown as T,
        ],
        rowCount: 1,
      };
    }
    if (text.includes("INSERT INTO camera") || text.includes("UPDATE camera SET") || text.includes("FROM camera WHERE")) {
      return { rows: [CAMERA_ROW as unknown as T], rowCount: 1 };
    }
    throw new Error(`unexpected query: ${text}`);
  }
}

describe("camera repository", () => {
  it("insertCamera → getCameraByDeviceId 매핑(snake→camel, 숫자 캐스팅)", async () => {
    const db = new FakeCameraDb();
    const created = await insertCamera(db, {
      deviceId: "cam-1",
      protocol: "RTSP",
      streamUrl: "rtsp://mediamtx:8554/cam-01",
      isPtz: true,
      fovDeg: 90,
      headingDeg: 180,
    });
    expect(created.deviceId).toBe("cam-1");
    expect(created.isPtz).toBe(true);
    expect(created.fovDeg).toBe(90);

    const fetched = await getCameraByDeviceId(db, "cam-1");
    expect(fetched?.streamUrl).toBe("rtsp://mediamtx:8554/cam-01");
    // CameraRecord(내부 전용)에는 있지만 CameraSummary(API 응답)에는 없어야 하는 필드 — 노출 방지.
    expect(fetched).toHaveProperty("onvifUsername");
    expect(fetched).toHaveProperty("onvifPassword");
  });

  it("updateCamera는 지정한 필드만 SET한다", async () => {
    const db = new FakeCameraDb();
    await updateCamera(db, "cam-1", { headingDeg: 270 });
    const updateStatement = db.statements.find((s) => s.includes("UPDATE camera SET"));
    expect(updateStatement).toContain("heading_deg = $2");
    expect(updateStatement).not.toContain("stream_url = $");
  });

  it("listCameras(areaId)는 camera_coverage로 조인한다", async () => {
    const db = new FakeCameraDb();
    const cameras = await listCameras(db, { areaId: "area-1" });
    expect(cameras[0]?.deviceId).toBe("cam-1");
    expect(cameras[0]?.areaId).toBe("area-1");
    expect(cameras[0]?.areaTopicPrefix).toBe("enterprise/site1/bldg-a/1f/lobby");
    expect(db.statements[0]).toContain("JOIN camera_coverage cc");
  });

  it("getCameraSummaryByDeviceId는 device+camera 조인 결과 1건을 반환한다", async () => {
    const db = new FakeCameraDb();
    const summary = await getCameraSummaryByDeviceId(db, "cam-1");
    expect(summary?.code).toBe("cam-01");
    expect(summary?.isPtz).toBe(true);
  });

  it("presets: create → list", async () => {
    const db = new FakeCameraDb();
    const preset = await createCameraPreset(db, { cameraId: "cam-1", name: "정문", pan: 0, tilt: 10, zoom: 1 });
    expect(preset.id).toBe("preset-1");
    expect(preset.tilt).toBe(10);

    const presets = await listCameraPresets(db, "cam-1");
    expect(presets[0]?.name).toBe("정문");
  });

  it("coverage: add/remove/list", async () => {
    const db = new FakeCameraDb();
    await addCameraCoverage(db, "cam-1", "area-1");
    await removeCameraCoverage(db, "cam-1", "area-1");
    const areaIds = await listCameraCoverageAreaIds(db, "cam-1");
    expect(areaIds).toEqual(["area-1"]);
    expect(db.statements.some((s) => s.includes("ON CONFLICT (camera_id, area_id) DO NOTHING"))).toBe(true);
  });
});
