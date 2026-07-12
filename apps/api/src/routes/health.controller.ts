import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/auth.decorators.js";
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
}
