import { Injectable } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { isAdmin } from "@smarthome/auth";
import { listDevices, listGroupControlSummaries, query } from "@smarthome/db";

const groupExecutor = { query };

@Injectable()
export class GroupsService {
  async listControlSummaries(auth: AuthContext): Promise<unknown> {
    const groups = await listGroupControlSummaries(groupExecutor);
    if (isAdmin(auth)) return groups;

    const allowedAreaPrefixes = new Set(auth.topics.map((t) => t.replace(/\/#$/, "")));
    const visibleGroups = [];
    for (const group of groups) {
      const members = await listDevices(groupExecutor, { groupId: group.id });
      const allowedMembers = members.filter(
        (device) =>
          device.deviceRole === "SENSOR" &&
          device.monitoringVisible &&
          device.enabled &&
          device.lifecycleStatus !== "DECOMMISSIONED" &&
          device.areaTopicPrefix !== null &&
          allowedAreaPrefixes.has(device.areaTopicPrefix),
      );
      if (allowedMembers.length > 0) {
        const onCount = allowedMembers.filter((device) => device.currentStatus === "ON").length;
        const offCount = allowedMembers.filter((device) => device.currentStatus === "OFF").length;
        visibleGroups.push({
          ...group,
          totalCount: allowedMembers.length,
          onCount,
          offCount,
          unknownCount: allowedMembers.length - onCount - offCount,
        });
      }
    }
    return visibleGroups;
  }

  async listControlDevices(groupId: string, auth: AuthContext): Promise<unknown> {
    const devices = await listDevices(groupExecutor, { groupId });
    const activeSensors = devices.filter(
      (device) =>
        device.deviceRole === "SENSOR" &&
        device.monitoringVisible &&
        device.enabled &&
        device.lifecycleStatus !== "DECOMMISSIONED",
    );
    if (isAdmin(auth)) return activeSensors;

    const allowedAreaPrefixes = new Set(auth.topics.map((t) => t.replace(/\/#$/, "")));
    return activeSensors.filter(
      (device) => device.areaTopicPrefix !== null && allowedAreaPrefixes.has(device.areaTopicPrefix),
    );
  }
}
