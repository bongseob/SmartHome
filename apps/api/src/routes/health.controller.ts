import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/auth.decorators.js";

@Controller("health")
export class HealthController {
  @Public()
  @Get()
  health(): { status: "ok"; service: "api" } {
    return { status: "ok", service: "api" };
  }
}
