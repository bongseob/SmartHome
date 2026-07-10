import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { isAdmin } from "@smarthome/auth";
import {
  getDeviceState,
  getFloorOverview,
  insertAuditLog,
  listFloors,
  query,
  updateDevicePosition,
  withTransaction,
  type FloorSummary,
} from "@smarthome/db";

const executor = { query };

export interface LayoutPositionInput {
  deviceId: string;
  posX: number;
  posY: number;
}

export interface SaveLayoutRequest {
  positions: LayoutPositionInput[];
}

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

  /**
   * 도면 편집 모드에서 변경된 기기 좌표를 한 번에 커밋한다(ui-ux-design.md §4.1-mode).
   * 위치 변경은 감사 대상(DEVICE_RELOCATE) — 전체를 한 transaction으로 묶어 부분 실패를 막는다.
   */
  async saveLayout(_floorId: string, body: SaveLayoutRequest, auth: AuthContext): Promise<unknown> {
    if (!body.positions || body.positions.length === 0) {
      throw new BadRequestException("positions is required");
    }

    return withTransaction(async (client) => {
      const updated = [];
      for (const pos of body.positions) {
        const before = await getDeviceState(client, pos.deviceId);
        if (!before) {
          throw new NotFoundException(`device not found: ${pos.deviceId}`);
        }
        const device = await updateDevicePosition(client, pos.deviceId, pos.posX, pos.posY);
        if (!device) {
          throw new NotFoundException(`device not found: ${pos.deviceId}`);
        }
        await insertAuditLog(client, {
          actorType: "ADMIN",
          actorId: auth.userId,
          targetType: "DEVICE",
          targetId: pos.deviceId,
          command: "DEVICE_RELOCATE",
          reason: `(${before.posX ?? "null"},${before.posY ?? "null"}) → (${pos.posX},${pos.posY})`,
          executionStatus: "SUCCEEDED",
          mqttReasonCode: null,
          sessionId: null,
          commandId: null,
        });
        updated.push(device);
      }
      return updated;
    });
  }
}
