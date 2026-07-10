import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { DeviceAccessGuard } from "../auth/device-access.guard.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { AuthController } from "../routes/auth.controller.js";
import { HealthController } from "../routes/health.controller.js";
import { CommandsController } from "../routes/commands.controller.js";
import { DevicesController } from "../routes/devices.controller.js";
import { SpatialController } from "../routes/spatial.controller.js";
import { AuthService } from "../services/auth.service.js";
import { CommandsService } from "../services/commands.service.js";
import { DevicesService } from "../services/devices.service.js";
import { SpatialService } from "../services/spatial.service.js";

@Module({
  controllers: [HealthController, AuthController, CommandsController, DevicesController, SpatialController],
  providers: [
    AuthService,
    CommandsService,
    DevicesService,
    SpatialService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: DeviceAccessGuard },
  ],
})
export class AppModule {}
