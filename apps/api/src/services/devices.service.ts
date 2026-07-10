import { Injectable, NotFoundException } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { isAdmin } from "@smarthome/auth";
import { getDeviceHistory, getDeviceState, listDevices, query } from "@smarthome/db";

const deviceExecutor = { query };

@Injectable()
export class DevicesService {
  async list(
    filter: { areaId?: string; category?: string; status?: string },
    auth: AuthContext,
  ): Promise<unknown> {
    const devices = await listDevices(deviceExecutor, filter);
    if (isAdmin(auth)) return devices;

    // 사용자의 ACL topic에서 area 프리픽스 집합 추출
    const allowedAreaPrefixes = new Set(
      auth.topics.map((t) => t.replace(/\/#$/, "")),
    );
    return devices.filter(
      (d) => d.areaTopicPrefix !== null && allowedAreaPrefixes.has(d.areaTopicPrefix),
    );
  }

  async state(id: string): Promise<unknown> {
    const device = await getDeviceState(deviceExecutor, id);
    if (!device) {
      throw new NotFoundException(`device not found: ${id}`);
    }
    return device;
  }

  async history(id: string, limit?: string): Promise<unknown> {
    const parsedLimit = limit ? Number(limit) : 20;
    const deviceHistory = await getDeviceHistory(
      deviceExecutor,
      id,
      Number.isFinite(parsedLimit) ? parsedLimit : 20,
    );
    if (!deviceHistory) {
      throw new NotFoundException(`device not found: ${id}`);
    }
    return deviceHistory;
  }
}
