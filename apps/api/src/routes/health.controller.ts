import { Controller, Get } from "@nestjs/common";
import { Public, Roles } from "../auth/auth.decorators.js";
import { CommandsService } from "../services/commands.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly commands: CommandsService) {}

  @Public()
  @Get()
  health(): { status: "ok" | "error"; service: "api"; mqtt: "connected" | "disconnected" } {
    const isConnected = this.commands.isMqttConnected();
    return {
      status: isConnected ? "ok" : "error",
      service: "api",
      mqtt: isConnected ? "connected" : "disconnected",
    };
  }

  /**
   * 서버 상태 위젯(web) 전용 — gateway/scheduler/device-simulator는 별도 HTTP 서버를 두지 않고,
   * 각 서비스가 이미 맺고 있는 MQTT 연결의 프레즌스(LWT+retained, CommandsService가 구독)를 그대로 반환한다.
   * mqtt/redis는 API 자신이 이미 맺고 있는 연결(브로커·Redis 공용 인스턴스)의 상태를 대신 알려준다.
   */
  @Roles("ADMIN")
  @Get("system")
  system(): {
    api: { status: "ok" | "error" };
    mqtt: { status: "ok" | "error" };
    redis: { status: "ok" | "error" };
    gateway: { status: "ok" | "error" };
    scheduler: { status: "ok" | "error" };
    simulator: { status: "ok" | "error" };
  } {
    const toHealth = (ok: boolean) => ({ status: (ok ? "ok" : "error") as "ok" | "error" });
    const statuses = this.commands.getServiceStatuses();
    const fromPresence = (s: "ONLINE" | "OFFLINE") => toHealth(s === "ONLINE");
    return {
      api: { status: "ok" },
      mqtt: toHealth(this.commands.isMqttConnected()),
      redis: toHealth(this.commands.isRedisConnected()),
      gateway: fromPresence(statuses.gateway),
      scheduler: fromPresence(statuses.scheduler),
      simulator: fromPresence(statuses["device-simulator"]),
    };
  }
}
