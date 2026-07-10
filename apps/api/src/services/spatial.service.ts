import { Injectable, NotFoundException } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { isAdmin } from "@smarthome/auth";
import {
  getFloorOverview,
  listFloors,
  query,
  type FloorSummary,
} from "@smarthome/db";

const executor = { query };

/**
 * Area ACL 기반 필터링 헬퍼.
 * ADMIN은 전체 접근, 그 외는 topics(ACL wildcard)에 포함된 area만 노출.
 */
function filterFloorsByAuth(floors: FloorSummary[], auth: AuthContext): FloorSummary[] {
  if (isAdmin(auth)) return floors;
  // 사용자의 ACL topic에서 area 레벨 프리픽스 추출
  // "enterprise/site1/bldg-a/2f/living-room/#" → "enterprise/site1/bldg-a/2f"
  const allowedFloorPrefixes = new Set(
    auth.topics
      .map((t) => t.replace(/\/#$/, ""))
      .map((t) => t.split("/").slice(0, 4).join("/")),
  );
  return floors.filter((f) => allowedFloorPrefixes.has(f.topicPrefix));
}

@Injectable()
export class SpatialService {
  async listFloors(auth: AuthContext): Promise<unknown> {
    const floors = await listFloors(executor);
    return filterFloorsByAuth(floors, auth);
  }

  async floorOverview(floorId: string, auth: AuthContext): Promise<unknown> {
    const overview = await getFloorOverview(executor, floorId);
    if (!overview) {
      throw new NotFoundException(`floor not found: ${floorId}`);
    }

    if (!isAdmin(auth)) {
      // areas / devices를 권한 있는 area만 필터링
      const allowedAreaPrefixes = new Set(
        auth.topics.map((t) => t.replace(/\/#$/, "")),
      );
      overview.areas = overview.areas.filter((a) =>
        allowedAreaPrefixes.has(a.topicPrefix),
      );
      overview.devices = overview.devices.filter(
        (d) => d.areaTopicPrefix !== null && allowedAreaPrefixes.has(d.areaTopicPrefix),
      );
    }
    return overview;
  }
}
