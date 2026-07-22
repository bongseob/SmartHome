import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { hasAreaAccess, isAdmin, issueStreamToken } from "@smarthome/auth";
import {
  InvalidTopicSegmentError,
  PtzGotoPresetArgs,
  PtzMoveArgs,
  SEGMENT_PATTERN,
  buildDeviceBase,
  CameraProtocol,
} from "@smarthome/contracts";
import {
  addCameraCoverage,
  createCameraPreset,
  createDevice,
  getAreaSlugPath,
  getCameraPresetById,
  getCameraSummaryByDeviceId,
  insertAuditLog,
  insertCamera,
  listCameraPresets,
  listCameras,
  query,
  removeCameraCoverage,
  updateCamera,
  withTransaction,
  type CameraSummary,
} from "@smarthome/db";
import { CommandsService } from "./commands.service.js";

const cameraExecutor = { query };

export interface CreateCameraRequest {
  code: string;
  name: string;
  areaId: string;
  protocol: string;
  streamUrl: string;
  onvifEndpoint?: string | null;
  isPtz?: boolean;
  resolution?: string | null;
  fovDeg?: number | null;
  headingDeg?: number | null;
  manufacturer?: string | null;
  model?: string | null;
  onvifUsername?: string | null;
  onvifPassword?: string | null;
}

export interface UpdateCameraRequest {
  streamUrl?: string;
  onvifEndpoint?: string | null;
  isPtz?: boolean;
  resolution?: string | null;
  fovDeg?: number | null;
  headingDeg?: number | null;
  onvifUsername?: string | null;
  onvifPassword?: string | null;
}

export interface CreateCameraPresetRequest {
  name: string;
  pan?: number | null;
  tilt?: number | null;
  zoom?: number | null;
}

export interface CameraStreamResponse {
  hlsUrl: string;
  webrtcUrl: string;
  /** MediaMTX authHTTPAddress 웹훅(media-gateway)이 검증할 단기 서명 토큰. 재생 클라이언트가
   *  `Authorization: Bearer <token>` 헤더로 실어 보낸다(mediamtx.org 문서 권장 방식). */
  token: string;
  expiresAt: string;
}

/** camera.stream_url(예: rtsp://mediamtx:8554/cam-01)에서 MediaMTX 경로(cam-01)만 뽑아낸다.
 *  HLS/WebRTC 재생 URL도 같은 경로를 쓴다(포트만 다름) — RTSP ingest와 재생이 같은 path다. */
function extractMediaMtxPath(streamUrl: string): string {
  try {
    return new URL(streamUrl).pathname.replace(/^\//, "");
  } catch {
    throw new BadRequestException(`streamUrl is not a valid URL: ${streamUrl}`);
  }
}

/**
 * 카메라 관리(architecture.md §5-cam, api-spec.md §4-cam) — ADMIN 전용, 변경은 감사 대상.
 * 카메라는 category=CAMERA device의 1:1 확장이라, 일반 device 생성(POST /devices)과 별개로
 * device+camera row를 한 transaction에서 함께 만든다(devices.service.ts의 category 검증이
 * CAMERA를 막아두는 이유 — "별도 등록"이 바로 이 서비스다).
 */
@Injectable()
export class CamerasService {
  constructor(private readonly commands: CommandsService) {}

  async list(filter: { areaId?: string; isPtz?: boolean }, auth: AuthContext): Promise<CameraSummary[]> {
    const cameras = await listCameras(cameraExecutor, filter);
    if (isAdmin(auth)) return cameras;

    // devices.service.ts와 동일하게 area가 아닌 카메라 자신의 mqttTopic으로 검사(코드 리뷰 P1-3).
    return cameras.filter((c) => hasAreaAccess(auth, c.mqttTopic));
  }

  async get(id: string): Promise<CameraSummary> {
    const camera = await getCameraSummaryByDeviceId(cameraExecutor, id);
    if (!camera) throw new NotFoundException(`camera not found: ${id}`);
    return camera;
  }

  /**
   * 서명된 단기 스트림 URL 발급(architecture.md §5-cam). 영상 자체는 MQTT를 거치지 않고
   * MediaMTX가 직접 서빙 — 여기서는 재생 권한이 있는 사용자에게만 짧게 유효한 토큰을 준다.
   * 실제 재생 시 MediaMTX가 매 요청마다 media-gateway의 /auth 웹훅으로 이 토큰을 검증한다.
   */
  async getStreamUrl(id: string): Promise<CameraStreamResponse> {
    const camera = await this.get(id);
    const secret = process.env.AUTH_JWT_SECRET;
    if (!secret) throw new Error("AUTH_JWT_SECRET is not configured");

    const path = extractMediaMtxPath(camera.streamUrl);
    const ttlSeconds = Number(process.env.STREAM_TOKEN_TTL_SECONDS ?? "300");
    const token = issueStreamToken({ cameraId: camera.deviceId, path }, secret, ttlSeconds);
    const hlsBase = process.env.MEDIAMTX_HLS_BASE ?? "http://localhost:8888";
    const webrtcBase = process.env.MEDIAMTX_WEBRTC_BASE ?? "http://localhost:8889";

    return {
      hlsUrl: `${hlsBase}/${path}/index.m3u8`,
      webrtcUrl: `${webrtcBase}/${path}/whep`,
      token,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }

  /** 기기 생성 규칙은 devices.service.ts의 create()와 동일 — mqtt_topic은 서버가 생성한다. */
  async create(body: CreateCameraRequest, auth: AuthContext): Promise<CameraSummary> {
    if (!body.code?.trim()) throw new BadRequestException("code는 필수입니다.");
    if (!SEGMENT_PATTERN.test(body.code)) {
      throw new BadRequestException("code는 소문자 영숫자 및 하이픈만 가능합니다 (예: cam-lobby-01).");
    }
    if (!body.name?.trim()) throw new BadRequestException("name은 필수입니다.");
    const protocol = CameraProtocol.safeParse(body.protocol);
    if (!protocol.success) {
      throw new BadRequestException(`protocol은 ${CameraProtocol.options.join(", ")} 중 하나여야 합니다.`);
    }
    if (!body.streamUrl?.trim()) throw new BadRequestException("streamUrl은 필수입니다.");
    if (protocol.data === "ONVIF" && !body.onvifEndpoint?.trim()) {
      throw new BadRequestException("protocol=ONVIF는 onvifEndpoint가 필요합니다.");
    }

    return withTransaction(async (client) => {
      const slugPath = await getAreaSlugPath(client, body.areaId);
      if (!slugPath) throw new NotFoundException(`area not found: ${body.areaId}`);

      let mqttTopic: string;
      try {
        mqttTopic = buildDeviceBase({
          site: slugPath.siteSlug,
          building: slugPath.buildingSlug,
          floor: slugPath.floorSlug,
          area: slugPath.areaSlug,
          device: body.code,
        });
      } catch (e) {
        if (e instanceof InvalidTopicSegmentError) {
          throw new BadRequestException(`invalid topic segment: ${e.field}='${e.value}'`);
        }
        throw e;
      }

      let device;
      try {
        device = await createDevice(client, {
          code: body.code,
          name: body.name.trim(),
          category: "CAMERA",
          deviceRole: "MONITORING_EQUIPMENT", // 카메라도 개별 접점(SENSOR)이 아닌 단일 장비 — GATEWAY와 동일 관례
          manufacturer: body.manufacturer ?? null,
          model: body.model ?? null,
          mqttTopic,
          areaId: body.areaId,
        });
      } catch (e) {
        if ((e as { code?: string }).code === "23505") {
          throw new BadRequestException(`code '${body.code}' 또는 mqtt_topic이 이미 존재합니다.`);
        }
        throw e;
      }

      await insertCamera(client, {
        deviceId: device.id,
        protocol: protocol.data,
        streamUrl: body.streamUrl,
        onvifEndpoint: body.onvifEndpoint ?? null,
        isPtz: body.isPtz ?? false,
        resolution: body.resolution ?? null,
        fovDeg: body.fovDeg ?? null,
        headingDeg: body.headingDeg ?? null,
        onvifUsername: body.onvifUsername ?? null,
        onvifPassword: body.onvifPassword ?? null,
      });

      await insertAuditLog(client, {
        actorType: "ADMIN",
        actorId: auth.userId,
        targetType: "DEVICE",
        targetId: device.id,
        command: "CAMERA_CREATE",
        reason: `camera '${device.code}' created (protocol=${protocol.data}, mqtt_topic=${device.mqttTopic})`,
        executionStatus: "SUCCEEDED",
        mqttReasonCode: null,
        sessionId: null,
        commandId: null,
      });

      const summary = await getCameraSummaryByDeviceId(client, device.id);
      if (!summary) throw new Error("camera insert did not return a summary");
      return summary;
    });
  }

  /** 스트림·PTZ·설치 방향 설정 수정. 이름 변경 등 device 공통 필드는 기존 PATCH /devices/:id 재사용. */
  async update(id: string, body: UpdateCameraRequest, auth: AuthContext): Promise<CameraSummary> {
    return withTransaction(async (client) => {
      const before = await getCameraSummaryByDeviceId(client, id);
      if (!before) throw new NotFoundException(`camera not found: ${id}`);

      const updated = await updateCamera(client, id, body);
      if (!updated) throw new NotFoundException(`camera not found: ${id}`);

      const changes: string[] = [];
      if (body.streamUrl !== undefined && body.streamUrl !== before.streamUrl) {
        changes.push(`streamUrl '${before.streamUrl}' → '${body.streamUrl}'`);
      }
      if (body.isPtz !== undefined && body.isPtz !== before.isPtz) {
        changes.push(`isPtz ${before.isPtz} → ${body.isPtz}`);
      }
      if (body.headingDeg !== undefined && body.headingDeg !== before.headingDeg) {
        changes.push(`headingDeg ${before.headingDeg ?? "null"} → ${body.headingDeg ?? "null"}`);
      }
      if (body.fovDeg !== undefined && body.fovDeg !== before.fovDeg) {
        changes.push(`fovDeg ${before.fovDeg ?? "null"} → ${body.fovDeg ?? "null"}`);
      }

      await insertAuditLog(client, {
        actorType: "ADMIN",
        actorId: auth.userId,
        targetType: "DEVICE",
        targetId: id,
        command: "CAMERA_UPDATE",
        reason: changes.length > 0 ? changes.join(", ") : "no changes",
        executionStatus: "SUCCEEDED",
        mqttReasonCode: null,
        sessionId: null,
        commandId: null,
      });

      const summary = await getCameraSummaryByDeviceId(client, id);
      if (!summary) throw new Error("camera update did not return a summary");
      return summary;
    });
  }

  async listPresets(cameraId: string) {
    await this.get(cameraId);
    return listCameraPresets(cameraExecutor, cameraId);
  }

  async createPreset(cameraId: string, body: CreateCameraPresetRequest, auth: AuthContext) {
    if (!body.name?.trim()) throw new BadRequestException("name은 필수입니다.");
    return withTransaction(async (client) => {
      const camera = await getCameraSummaryByDeviceId(client, cameraId);
      if (!camera) throw new NotFoundException(`camera not found: ${cameraId}`);

      const preset = await createCameraPreset(client, {
        cameraId,
        name: body.name.trim(),
        pan: body.pan ?? null,
        tilt: body.tilt ?? null,
        zoom: body.zoom ?? null,
        createdBy: auth.userId,
      });

      await insertAuditLog(client, {
        actorType: "ADMIN",
        actorId: auth.userId,
        targetType: "DEVICE",
        targetId: cameraId,
        command: "CAMERA_PRESET_CREATE",
        reason: `preset '${preset.name}' created (pan=${preset.pan ?? "null"}, tilt=${preset.tilt ?? "null"}, zoom=${preset.zoom ?? "null"})`,
        executionStatus: "SUCCEEDED",
        mqttReasonCode: null,
        sessionId: null,
        commandId: null,
      });

      return preset;
    });
  }

  async validatePresetBelongsToCamera(cameraId: string, presetId: string): Promise<void> {
    const preset = await getCameraPresetById(cameraExecutor, presetId);
    if (!preset || preset.cameraId !== cameraId) {
      throw new NotFoundException(`preset not found for camera: ${presetId}`);
    }
  }

  /**
   * PTZ 이동 — 일반 명령 흐름(§4 command-flow)을 그대로 재사용한다(mqtt-command 스킬 원칙).
   * 여기서 하는 건 "이 카메라가 PTZ를 지원하는지·인자가 유효한지" 검증뿐이고, 실제 발행·
   * 수명주기·감사는 CommandsService.create()가 device 제어와 완전히 동일하게 처리한다.
   * 실행(ONVIF 변환)은 gateway의 카메라 어댑터가 이 명령을 구독해 담당한다.
   */
  async ptz(cameraId: string, body: unknown, auth: AuthContext): Promise<unknown> {
    const camera = await this.get(cameraId);
    if (!camera.isPtz) {
      throw new BadRequestException("카메라가 PTZ를 지원하지 않습니다.");
    }
    const parsed = PtzMoveArgs.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(`invalid ptz args: ${parsed.error.message}`);
    }
    return this.commands.create(
      { command: "ptz_move", target: { id: cameraId }, args: parsed.data as Record<string, unknown> },
      auth,
    );
  }

  async gotoPreset(cameraId: string, presetId: string, auth: AuthContext): Promise<unknown> {
    const camera = await this.get(cameraId);
    if (!camera.isPtz) {
      throw new BadRequestException("카메라가 PTZ를 지원하지 않습니다.");
    }
    await this.validatePresetBelongsToCamera(cameraId, presetId);
    const args: PtzGotoPresetArgs = { presetId };
    return this.commands.create(
      { command: "ptz_goto_preset", target: { id: cameraId }, args: args as Record<string, unknown> },
      auth,
    );
  }

  async addCoverage(cameraId: string, areaId: string, auth: AuthContext): Promise<{ mapped: true }> {
    await this.get(cameraId);
    // 업무 변경(addCameraCoverage)과 insertAuditLog를 같은 트랜잭션으로 묶는다 — 예전엔 별도
    // executor로 순차 호출해서, audit insert가 실패해도 커버리지 매핑만 남을 수 있었다
    // (코드 리뷰 P1 #3). withTransaction 클라이언트는 QueryExecutor와 호환된다.
    await withTransaction(async (client) => {
      await addCameraCoverage(client, cameraId, areaId);
      await insertAuditLog(client, {
        actorType: "ADMIN",
        actorId: auth.userId,
        targetType: "DEVICE",
        targetId: cameraId,
        command: "CAMERA_COVERAGE_ADD",
        reason: `area '${areaId}' 커버리지 추가`,
        executionStatus: "SUCCEEDED",
        mqttReasonCode: null,
        sessionId: null,
        commandId: null,
      });
    });
    return { mapped: true };
  }

  async removeCoverage(cameraId: string, areaId: string, auth: AuthContext): Promise<{ removed: true }> {
    await this.get(cameraId);
    await withTransaction(async (client) => {
      await removeCameraCoverage(client, cameraId, areaId);
      await insertAuditLog(client, {
        actorType: "ADMIN",
        actorId: auth.userId,
        targetType: "DEVICE",
        targetId: cameraId,
        command: "CAMERA_COVERAGE_REMOVE",
        reason: `area '${areaId}' 커버리지 해제`,
        executionStatus: "SUCCEEDED",
        mqttReasonCode: null,
        sessionId: null,
        commandId: null,
      });
    });
    return { removed: true };
  }
}
