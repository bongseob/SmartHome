import { Injectable } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import { hasAreaAccess, isAdmin } from "@smarthome/auth";
import { listDevices, listGroupControlSummaries, query } from "@smarthome/db";

const groupExecutor = { query };

@Injectable()
export class GroupsService {
  async listControlSummaries(auth: AuthContext): Promise<unknown> {
    const groups = await listGroupControlSummaries(groupExecutor);
    if (isAdmin(auth)) return groups;

    const visibleGroups = [];
    for (const group of groups) {
      const members = await listDevices(groupExecutor, { groupId: group.id });
      // area가 아닌 기기 자신의 mqttTopic으로 검사 — area 권한뿐 아니라 device/group 단독
      // 권한(listUserTopicClaims가 심어준 기기별 topic)도 함께 반영된다(코드 리뷰 P1-2·P1-3).
      const allowedMembers = members.filter(
        (device) =>
          device.deviceRole === "SENSOR" &&
          device.monitoringVisible &&
          device.enabled &&
          device.lifecycleStatus !== "DECOMMISSIONED" &&
          hasAreaAccess(auth, device.mqttTopic),
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

    return activeSensors.filter((device) => hasAreaAccess(auth, device.mqttTopic));
  }
}
