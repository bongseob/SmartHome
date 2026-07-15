import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { isAdmin } from "@smarthome/auth";
import { AreaKind } from "@smarthome/contracts";
import {
  createArea,
  deleteArea,
  getAreaById,
  getAreaOverview,
  getAreaSummaryById,
  getDeviceState,
  insertAuditLog,
  insertFloor,
  listAreas,
  listBuildings,
  listFloors,
  listSites,
  query,
  updateArea,
  updateBuildingName,
  updateDevicePosition,
  updateSiteName,
  withTransaction,
  type AreaSummary,
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

/** Area의 polygon은 [[x,y], ...] 최소 삼각형(3점)이어야 한다. 지금은 UI에서 안 쓰지만
 *  createAreaUnderFloor/updateArea의 하위 호환 경로(폴리곤 지정 시)에서 여전히 검증한다. */
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

/** 사용자의 ACL topic(User Properties wildcard)에서 "/#" 접미사를 뗀 허용 area topicPrefix 집합. */
function allowedAreaPrefixes(auth: AuthContext): Set<string> {
  return new Set(auth.topics.map((t) => t.replace(/\/#$/, "")));
}

function filterAreasByAuth(areas: AreaSummary[], auth: AuthContext): AreaSummary[] {
  if (isAdmin(auth)) return areas;
  const allowed = allowedAreaPrefixes(auth);
  return areas.filter((a) => allowed.has(a.topicPrefix));
}

@Injectable()
export class SpatialService {
  /**
   * 지역(=area) 목록. area가 1차 관리 단위다(2026-07-15 합의) — floor는 여러 지역이 공유하는
   * 층 태그일 뿐이라 floor 자체는 ACL 대상이 아니고, area의 topicPrefix로 직접 필터링한다.
   */
  async listAreas(auth: AuthContext): Promise<unknown> {
    const areas = await listAreas(executor);
    return filterAreasByAuth(areas, auth);
  }

  /** 전체 모니터링의 층별 집계 + "지역 생성" 시 층 태그 선택용. floor 자체는 ACL 대상이 아니다. */
  async listFloors(): Promise<unknown> {
    return listFloors(executor);
  }

  /** 관제 화면(FloorMap)용 — 지역 1개의 배경 이미지 + 기기 목록. */
  async areaOverview(areaId: string, auth: AuthContext): Promise<unknown> {
    const overview = await getAreaOverview(executor, areaId);
    if (!overview) {
      throw new NotFoundException(`area not found: ${areaId}`);
    }
    if (!isAdmin(auth) && !allowedAreaPrefixes(auth).has(overview.area.topicPrefix)) {
      throw new ForbiddenException("no access to this area");
    }
    return overview;
  }

  /**
   * 지역 생성 — 사용자에게는 "지역" 하나의 개념만 노출한다(2026-07-15 합의). floorId(기존 층 태그
   * 선택) 또는 floorName(새 층 태그 입력) 중 하나를 받아, 새 층 태그면 같은 트랜잭션에서 만든다.
   * 배경 이미지는 생성 후 updateArea(imageId)로 별도 지정한다. ADMIN 전용, 감사 대상.
   */
  async createArea(
    body: { name: string; floorId?: string; floorName?: string; slug?: string },
    auth: AuthContext,
  ): Promise<unknown> {
    if (!body.name || !body.name.trim()) {
      throw new BadRequestException("name is required");
    }
    const name = body.name.trim();
    const floorName = body.floorName?.trim();
    if (!body.floorId && !floorName) {
      throw new BadRequestException("floorId or floorName is required");
    }

    return withTransaction(async (client) => {
      let floorId = body.floorId;
      if (floorId) {
        const floors = await listFloors(client);
        if (!floors.find((f) => f.id === floorId)) {
          throw new NotFoundException(`floor not found: ${floorId}`);
        }
      } else {
        const buildings = await listBuildings(client);
        const only = buildings.length === 1 ? buildings[0] : undefined;
        if (!only) {
          throw new BadRequestException("floor 자동 생성 실패 — building이 1개가 아닙니다");
        }
        floorId = await insertFloor(client, {
          buildingId: only.id,
          slug: slugify(floorName as string),
          name: floorName as string,
        });
        await insertAuditLog(client, {
          actorType: "ADMIN",
          actorId: auth.userId,
          targetType: "FLOOR",
          targetId: floorId,
          command: "FLOOR_CREATE",
          reason: `지역 '${name}' 생성을 위해 층 태그 '${floorName}' 자동 생성`,
          executionStatus: "SUCCEEDED",
          mqttReasonCode: null,
          sessionId: null,
          commandId: null,
        });
      }

      const area = await createArea(client, {
        floorId,
        slug: body.slug?.trim() || slugify(name),
        name,
        polygon: [],
        createdBy: auth.userId,
      });
      await insertAuditLog(client, {
        actorType: "ADMIN",
        actorId: auth.userId,
        targetType: "AREA",
        targetId: area.id,
        command: "AREA_CREATE",
        reason: `지역 '${area.name}' 생성 (floor ${floorId})`,
        executionStatus: "SUCCEEDED",
        mqttReasonCode: null,
        sessionId: null,
        commandId: null,
      });
      // repo의 createArea()는 floorName/imageUrl 등이 빠진 얕은 Area만 반환하므로, 프론트가
      // 기대하는 AreaSummary(지역 목록/카드 렌더링에 필요한 전체 필드)로 다시 조회해 돌려준다.
      return getAreaSummaryById(client, area.id);
    });
  }

  /**
   * 도면 편집 모드에서 변경된 기기 좌표를 한 번에 커밋한다(ui-ux-design.md §4.1-mode).
   * 위치 변경은 감사 대상(DEVICE_RELOCATE) — 전체를 한 transaction으로 묶어 부분 실패를 막는다.
   */
  async saveAreaLayout(areaId: string, body: SaveLayoutRequest, auth: AuthContext): Promise<unknown> {
    if (!body.positions || body.positions.length === 0) {
      throw new BadRequestException("positions is required");
    }

    return withTransaction(async (client) => {
      const overview = await getAreaOverview(client, areaId);
      if (!overview) {
        throw new NotFoundException(`area not found: ${areaId}`);
      }
      const areaDeviceIds = new Set(overview.devices.map((device) => device.id));
      const invalidPosition = body.positions.find((position) => !areaDeviceIds.has(position.deviceId));
      if (invalidPosition) {
        throw new BadRequestException(
          `device ${invalidPosition.deviceId} does not belong to area ${areaId}`,
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

  /** 층에 이미 소속된 area 아래에 area를 추가하는 하위 호환 경로(분전반 등 향후 확장용).
   *  프론트는 더 이상 이 경로를 쓰지 않고 최상위 createArea()를 쓴다(2026-07-15). */
  async createAreaUnderFloor(
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
      return getAreaSummaryById(client, area.id);
    }));
  }

  /** 지역 이름 변경, 배경 이미지 지정(imageId), PANEL 좌표 등. ADMIN 전용, 감사 대상. */
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
      reason: `name '${before.name}' → '${updated.name}'${body.polygon !== undefined ? ", polygon 변경" : ""}${panel.imageId !== undefined ? `, imageId → ${panel.imageId ?? "null"}` : ""}`,
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
      });
      // repo의 updateArea()는 floorName/imageUrl 등이 빠진 얕은 Area만 반환한다 — 프론트(지역
      // 관리 화면)는 이 응답으로 목록의 해당 row를 통째로 교체하므로, 여기서 채워주지 않으면
      // 이름수정/이미지매핑을 할 때마다 그 지역의 층/배경 표시가 빈 값으로 덮어써진다.
      return getAreaSummaryById(client, id);
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
      reason: `지역 '${before.name}' 삭제 (기기 area 배정은 SET NULL 처리됨)`,
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
      });
      return { deleted: true };
    });
  }
}
