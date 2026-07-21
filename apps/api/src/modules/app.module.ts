import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { DeviceAccessGuard } from "../auth/device-access.guard.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { WsTicketService } from "../auth/ws-ticket.service.js";
import { AuthController } from "../routes/auth.controller.js";
import { HealthController } from "../routes/health.controller.js";
import { CommandsController } from "../routes/commands.controller.js";
import { DevicesController } from "../routes/devices.controller.js";
import { SpatialController } from "../routes/spatial.controller.js";
import { AlarmsController } from "../routes/alarms.controller.js";
import { AlarmPoliciesController } from "../routes/alarm-policies.controller.js";
import { SchedulersController } from "../routes/schedulers.controller.js";
import { HolidaysController } from "../routes/holidays.controller.js";
import { TimeProgramsController } from "../routes/time-programs.controller.js";
import { ImagesController } from "../routes/images.controller.js";
import { CamerasController } from "../routes/cameras.controller.js";
import { EventHistoryController } from "../routes/event-history.controller.js";
import { GroupsController } from "../routes/groups.controller.js";
import { RecommendationsController } from "../routes/recommendations.controller.js";
import { SystemSettingController } from "../routes/system-setting.controller.js";
import { AuthService } from "../services/auth.service.js";
import { CommandsService } from "../services/commands.service.js";
import { DevicesService } from "../services/devices.service.js";
import { SpatialService } from "../services/spatial.service.js";
import { AlarmsService } from "../services/alarms.service.js";
import { AlarmPoliciesService } from "../services/alarm-policies.service.js";
import { SchedulersService } from "../services/schedulers.service.js";
import { HolidaysService } from "../services/holidays.service.js";
import { TimeProgramsService } from "../services/time-programs.service.js";
import { ImagesService } from "../services/images.service.js";
import { CamerasService } from "../services/cameras.service.js";
import { EventHistoryService } from "../services/event-history.service.js";
import { GroupsService } from "../services/groups.service.js";
import { RecommendationsService } from "../services/recommendations.service.js";
import { SystemSettingService } from "../services/system-setting.service.js";

@Module({
  controllers: [
    HealthController,
    AuthController,
    CommandsController,
    DevicesController,
    SpatialController,
    AlarmsController,
    AlarmPoliciesController,
    SchedulersController,
    HolidaysController,
    TimeProgramsController,
    ImagesController,
    CamerasController,
    EventHistoryController,
    GroupsController,
    RecommendationsController,
    SystemSettingController,
  ],
  providers: [
    AuthService,
    WsTicketService,
    CommandsService,
    DevicesService,
    SpatialService,
    AlarmsService,
    AlarmPoliciesService,
    SchedulersService,
    HolidaysService,
    TimeProgramsService,
    ImagesService,
    CamerasService,
    EventHistoryService,
    GroupsService,
    RecommendationsService,
    SystemSettingService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: DeviceAccessGuard },
  ],
})
export class AppModule {}
