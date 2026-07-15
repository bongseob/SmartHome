import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import {
  getSystemName,
  insertAuditLog,
  listSystemSettings,
  query,
  updateSystemSetting,
  withTransaction,
  type SystemSettingRecord,
} from "@smarthome/db";

const executor = { query };

function isPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
}

/** UI가 임의 key/value를 만들지 못하도록, 마이그레이션으로 미리 시딩된 key만 모양을 검증해 받는다. */
function validateValue(key: string, value: unknown): unknown {
  switch (key) {
    case "system.name": {
      if (typeof value !== "string" || !value.trim()) {
        throw new BadRequestException("system.name must be a non-empty string");
      }
      return value.trim();
    }
    case "legacy.server_endpoint": {
      if (
        typeof value !== "object" ||
        value === null ||
        typeof (value as { host?: unknown }).host !== "string" ||
        !(value as { host: string }).host.trim() ||
        !isPort((value as { port?: unknown }).port)
      ) {
        throw new BadRequestException("legacy.server_endpoint must be { host: string, port: 1-65535 }");
      }
      return { host: (value as { host: string }).host.trim(), port: (value as { port: number }).port };
    }
    case "legacy.board_default_port": {
      if (!isPort(value)) {
        throw new BadRequestException("legacy.board_default_port must be an integer 1-65535");
      }
      return value;
    }
    default:
      throw new BadRequestException(`unknown system setting key: ${key}`);
  }
}

@Injectable()
export class SystemSettingService {
  /** 로그인 전에도 노출되는 표시 이름 — 민감정보가 아니라 인증 없이 공개한다. */
  async name(): Promise<{ name: string }> {
    return { name: await getSystemName(executor) };
  }

  async list(): Promise<SystemSettingRecord[]> {
    return listSystemSettings(executor);
  }

  /** ADMIN 전용, 감사 대상. 미리 시딩된 key만 값 수정 가능(키 신설은 마이그레이션으로만). */
  async update(key: string, value: unknown, auth: AuthContext): Promise<SystemSettingRecord> {
    const validated = validateValue(key, value);
    return withTransaction(async (client) => {
      const before = await listSystemSettings(client).then((rows) => rows.find((r) => r.key === key));
      if (!before) {
        throw new NotFoundException(`system setting not found: ${key}`);
      }
      const updated = await updateSystemSetting(client, key, validated, auth.userId);
      if (!updated) {
        throw new NotFoundException(`system setting not found: ${key}`);
      }
      await insertAuditLog(client, {
        actorType: "ADMIN",
        actorId: auth.userId,
        targetType: "SYSTEM_SETTING",
        targetId: key,
        command: "SYSTEM_SETTING_UPDATE",
        reason: `${key}: ${JSON.stringify(before.value)} → ${JSON.stringify(validated)}`,
        executionStatus: "SUCCEEDED",
        mqttReasonCode: null,
        sessionId: null,
        commandId: null,
      });
      return updated;
    });
  }
}
