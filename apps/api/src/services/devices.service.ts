import { Injectable, NotFoundException } from "@nestjs/common";
import { getDeviceHistory, getDeviceState, query } from "@smarthome/db";

const deviceExecutor = { query };

@Injectable()
export class DevicesService {
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
