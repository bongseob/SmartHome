import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { isAdmin } from "@smarthome/auth";
import { AreaKind } from "@smarthome/contracts";
import {
  createArea,
  deleteArea,
  getAreaById,
  getDeviceState,
  getFloorOverview,
  getImageById,
  insertAuditLog,
  insertFloorMap,
  listBuildings,
  listFloors,
  listSites,
  query,
  setFloorFloorMap,
  updateArea,
  updateBuildingName,
  updateDevicePosition,
  updateFloorMapScale,
  updateSiteName,
  withTransaction,
  type FloorSummary,
} from "@smarthome/db";

const executor = { query };

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "") || "area";
}

/** 분전반형 area 선택 필드(addendum §2.3). */
interface PanelAreaFields {
  kind?: string;
  imageId?: string | null;
  posX?: number | null;
  posY?: number | null;
}

interface ParsedPanelFields {
  kind?: "ROOM" | "PANEL";
  imageId?: string | null;
  posX?: number | null;
  posY?: number | null;
}

/** kind/imageId/posX/posY를 검증·정규화. 미지정 필드는 결과에서 생략(부분 업데이트 유지). */
function parsePanelFields(body: PanelAreaFields): ParsedPanelFields {
  const out: ParsedPanelFields = {};
  if (body.kind !== undefined) {
    const parsed = AreaKind.safeParse(body.kind);
    if (!parsed.success) throw new BadRequestException(`kind must be ROOM or PANEL: ${body.kind}`);
    out.kind = parsed.data;
  }
  if (body.imageId !== undefined) {
    if (body.imageId !== null && typeof body.imageId !== "string") {
      throw new BadRequestException("imageId must be a string or null");
    }
    out.imageId = body.imageId;
  }
  for (const axis of ["posX", "posY"] as const) {
    if (body[axis] !== undefined) {
      if (body[axis] !== null && typeof body[axis] !== "number") {
        throw new BadRequestException(`${axis} must be a number or null`);
      }
      out[axis] = body[axis];
    }
  }
  return out;
}

const PG_FK_VIOLATION = "23503";

/** area.image_id FK 위반(존재하지 않는 imageId)을 400으로 매핑. */
async function mapImageFkError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err &&
      (err as { code?: unknown }).code === PG_FK_VIOLATION) {
      throw new BadRequestException("imageId not found");
    }
    throw err;
  }
}

/** Area의 polygon은 [[x,y], ...] 최소 삼각형(3점)이어야 한다(FloorMap.tsx의 렌더링 요건과 동일). */
function isValidPolygon(polygon: unknown): polygon is number[][] {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  return polygon.every(
    (vertex) => Array.isArray(vertex) && vertex.length >= 2 && vertex.every((n) => typeof n === "number"),
  );
}

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
  async saveLayout(floorId: string, body: SaveLayoutRequest, auth: AuthContext): Promise<unknown> {
    if (!body.positions || body.positions.length === 0) {
      throw new BadRequestException("positions is required");
    }

    return withTransaction(async (client) => {
      const overview = await getFloorOverview(client, floorId);
      if (!overview) {
        throw new NotFoundException(`floor not found: ${floorId}`);
      }
      const floorDeviceIds = new Set(overview.devices.map((device) => device.id));
      const invalidPosition = body.positions.find((position) => !floorDeviceIds.has(position.deviceId));
      if (invalidPosition) {
        throw new BadRequestException(
          `device ${invalidPosition.deviceId} does not belong to floor ${floorId}`,
        );
      }

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

  /** 시스템 기본정보 관리(M16) — Site/Building 이름만 수정. ADMIN 전용, 감사 대상. */
  async listSites(): Promise<unknown> {
    return listSites(executor);
  }

  async updateSiteName(id: string, name: string, auth: AuthContext): Promise<unknown> {
    if (!name || !name.trim()) {
      throw new BadRequestException("name is required");
    }
    return withTransaction(async (client) => {
      const before = await listSites(client).then((sites) => sites.find((s) => s.id === id));
      if (!before) {
        throw new NotFoundException(`site not found: ${id}`);
      }
      const updated = await updateSiteName(client, id, name.trim());
      if (!updated) {
        throw new NotFoundException(`site not found: ${id}`);
      }
      await insertAuditLog(client, {
      actorType: "ADMIN",
      actorId: auth.userId,
      targetType: "SITE",
      targetId: id,
      command: "SITE_UPDATE_NAME",
      reason: `name '${before.name}' → '${name.trim()}'`,
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
      });
      return updated;
    });
  }

  async listBuildings(): Promise<unknown> {
    return listBuildings(executor);
  }

  async updateBuildingName(id: string, name: string, auth: AuthContext): Promise<unknown> {
    if (!name || !name.trim()) {
      throw new BadRequestException("name is required");
    }
    return withTransaction(async (client) => {
      const before = await listBuildings(client).then((buildings) => buildings.find((b) => b.id === id));
      if (!before) {
        throw new NotFoundException(`building not found: ${id}`);
      }
      const updated = await updateBuildingName(client, id, name.trim());
      if (!updated) {
        throw new NotFoundException(`building not found: ${id}`);
      }
      await insertAuditLog(client, {
      actorType: "ADMIN",
      actorId: auth.userId,
      targetType: "BUILDING",
      targetId: id,
      command: "BUILDING_UPDATE_NAME",
      reason: `name '${before.name}' → '${name.trim()}'`,
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
      });
      return updated;
    });
  }

  /**
   * 도면(Floor Map) 업로드(M16, SRS 2.1.1) — 이미지는 로컬 파일시스템에 저장되고(컨트롤러의
   * multer diskStorage), 여기서는 floor_map row 생성 + floor에 연결만 담당한다. ADMIN 전용, 감사 대상.
   */
  async uploadFloorMap(
    floorId: string,
    imageUrl: string,
    meta: { widthPx: number; heightPx: number; scaleMPerPx: number },
    auth: AuthContext,
  ): Promise<unknown> {
    if (
      !Number.isFinite(meta.widthPx) || meta.widthPx <= 0 ||
      !Number.isFinite(meta.heightPx) || meta.heightPx <= 0 ||
      !Number.isFinite(meta.scaleMPerPx) || meta.scaleMPerPx <= 0
    ) {
      throw new BadRequestException("widthPx/heightPx/scaleMPerPx must be positive numbers");
    }
    const floors = await listFloors(executor);
    const floor = floors.find((f) => f.id === floorId);
    if (!floor) {
      throw new NotFoundException(`floor not found: ${floorId}`);
    }

    return withTransaction(async (client) => {
      const floorMap = await insertFloorMap(client, {
        imageUrl,
        widthPx: meta.widthPx,
        heightPx: meta.heightPx,
        scaleMPerPx: meta.scaleMPerPx,
        uploadedBy: auth.userId,
      });
      await setFloorFloorMap(client, floorId, floorMap.id);
      await insertAuditLog(client, {
      actorType: "ADMIN",
      actorId: auth.userId,
      targetType: "FLOOR",
      targetId: floorId,
      command: "FLOOR_MAP_UPLOAD",
      reason: `floor_map ${floorMap.id} (${meta.widthPx}x${meta.heightPx}px, ${meta.scaleMPerPx}m/px), 이전 floor_map ${floor.floorMapId ?? "null"}`,
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
      });

      const updatedFloors = await listFloors(client);
      return updatedFloors.find((f) => f.id === floorId);
    });
  }

  async updateFloorMapScale(floorMapId: string, scaleMPerPx: number, auth: AuthContext): Promise<unknown> {
    if (!Number.isFinite(scaleMPerPx) || scaleMPerPx <= 0) {
      throw new BadRequestException("scaleMPerPx must be a positive number");
    }
    return withTransaction(async (client) => {
      const updated = await updateFloorMapScale(client, floorMapId, scaleMPerPx);
      if (!updated) {
        throw new NotFoundException(`floor_map not found: ${floorMapId}`);
      }
      await insertAuditLog(client, {
      actorType: "ADMIN",
      actorId: auth.userId,
      targetType: "FLOOR_MAP",
      targetId: floorMapId,
      command: "FLOOR_MAP_UPDATE_SCALE",
      reason: `scale_m_per_px → ${scaleMPerPx}`,
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
      });
      return updated;
    });
  }

  /**
   * 등록된 이미지 라이브러리 항목을 층 배경으로 매핑한다.
   * 이미지 업로드는 `/api/v1/images`에서 image 기본정보만 저장하고, 여기서 별도 매핑 과정을 거친다.
   */
  async assignFloorMapImage(
    floorId: string,
    imageId: string,
    scaleMPerPx: number,
    auth: AuthContext,
  ): Promise<unknown> {
    if (typeof imageId !== "string" || imageId.trim().length === 0) {
      throw new BadRequestException("imageId is required");
    }
    if (!Number.isFinite(scaleMPerPx) || scaleMPerPx <= 0) {
      throw new BadRequestException("scaleMPerPx must be a positive number");
    }

    const floors = await listFloors(executor);
    const floor = floors.find((f) => f.id === floorId);
    if (!floor) {
      throw new NotFoundException(`floor not found: ${floorId}`);
    }

    return withTransaction(async (client) => {
      const image = await getImageById(client, imageId);
      if (!image) {
        throw new NotFoundException(`image not found: ${imageId}`);
      }
      if (!image.widthPx || !image.heightPx) {
        throw new BadRequestException("image width/height metadata is required before mapping");
      }

      const floorMap = await insertFloorMap(client, {
        imageUrl: image.imageUrl,
        widthPx: image.widthPx,
        heightPx: image.heightPx,
        scaleMPerPx,
        uploadedBy: auth.userId,
      });
      await setFloorFloorMap(client, floorId, floorMap.id);
      await insertAuditLog(client, {
      actorType: "ADMIN",
      actorId: auth.userId,
      targetType: "FLOOR",
      targetId: floorId,
      command: "FLOOR_MAP_ASSIGN_IMAGE",
      reason: `image ${image.id} '${image.name}' → floor_map ${floorMap.id}, 이전 floor_map ${floor.floorMapId ?? "null"}`,
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
      });

      const updatedFloors = await listFloors(client);
      return updatedFloors.find((f) => f.id === floorId);
    });
  }

  /** 지역(Area) 관리(M16, SRS 2.1.1) — 생성/수정/삭제. ADMIN 전용, 감사 대상.
   *  분전반형(addendum §2.3): kind=PANEL·imageId(배경)·posX/posY 선택 지정. */
  async createArea(
    floorId: string,
    body: { name: string; polygon: unknown; slug?: string } & PanelAreaFields,
    auth: AuthContext,
  ): Promise<unknown> {
    if (!body.name || !body.name.trim()) {
      throw new BadRequestException("name is required");
    }
    if (!isValidPolygon(body.polygon)) {
      throw new BadRequestException("polygon must be an array of at least 3 [x,y] points");
    }
    const panel = parsePanelFields(body);
    const floors = await listFloors(executor);
    if (!floors.find((f) => f.id === floorId)) {
      throw new NotFoundException(`floor not found: ${floorId}`);
    }

    return mapImageFkError(() =>
    withTransaction(async (client) => {
      const area = await createArea(client, {
        floorId,
        slug: body.slug?.trim() || slugify(body.name),
        name: body.name.trim(),
        polygon: body.polygon,
        createdBy: auth.userId,
        ...panel,
      });
      await insertAuditLog(client, {
      actorType: "ADMIN",
      actorId: auth.userId,
      targetType: "AREA",
      targetId: area.id,
      command: "AREA_CREATE",
      reason: `area '${area.name}' (floor ${floorId})${panel.kind === "PANEL" ? " [PANEL]" : ""}`,
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
      });
      return area;
    }));
  }

  async updateArea(
    id: string,
    body: { name?: string; polygon?: unknown } & PanelAreaFields,
    auth: AuthContext,
  ): Promise<unknown> {
    if (body.name !== undefined && !body.name.trim()) {
      throw new BadRequestException("name must not be empty");
    }
    if (body.polygon !== undefined && !isValidPolygon(body.polygon)) {
      throw new BadRequestException("polygon must be an array of at least 3 [x,y] points");
    }
    const panel = parsePanelFields(body);

    return mapImageFkError(() =>
    withTransaction(async (client) => {
      const before = await getAreaById(client, id);
      if (!before) {
        throw new NotFoundException(`area not found: ${id}`);
      }
      const updated = await updateArea(client, id, {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.polygon !== undefined ? { polygon: body.polygon } : {}),
        ...panel,
      });
      if (!updated) {
        throw new NotFoundException(`area not found: ${id}`);
      }
      await insertAuditLog(client, {
      actorType: "ADMIN",
      actorId: auth.userId,
      targetType: "AREA",
      targetId: id,
      command: "AREA_UPDATE",
      reason: `name '${before.name}' → '${updated.name}'${body.polygon !== undefined ? ", polygon 변경" : ""}`,
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
      });
      return updated;
    }));
  }

  async deleteArea(id: string, auth: AuthContext): Promise<unknown> {
    return withTransaction(async (client) => {
      const before = await getAreaById(client, id);
      if (!before) {
        throw new NotFoundException(`area not found: ${id}`);
      }
      const deleted = await deleteArea(client, id);
      if (!deleted) {
        throw new NotFoundException(`area not found: ${id}`);
      }
      await insertAuditLog(client, {
      actorType: "ADMIN",
      actorId: auth.userId,
      targetType: "AREA",
      targetId: id,
      command: "AREA_DELETE",
      reason: `area '${before.name}' deleted (기기 area 배정은 SET NULL 처리됨)`,
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
      });
      return { deleted: true };
    });
  }
}
