import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import type { SystemSettingRecord } from "@smarthome/db";
import { CurrentAuth, Public, Roles } from "../auth/auth.decorators.js";
import { SystemSettingService } from "../services/system-setting.service.js";

@Controller("api/v1/system-settings")
export class SystemSettingController {
  constructor(private readonly systemSettings: SystemSettingService) {}

  /** 로그인 화면·브라우저 탭 제목용 — 인증 없이 조회 가능(health 엔드포인트와 동일 성격). */
  @Public()
  @Get("name")
  name(): Promise<{ name: string }> {
    return this.systemSettings.name();
  }

  @Roles("ADMIN")
  @Get()
  list(): Promise<SystemSettingRecord[]> {
    return this.systemSettings.list();
  }

  @Roles("ADMIN")
  @Patch(":key")
  update(
    @Param("key") key: string,
    @Body() body: { value: unknown },
    @CurrentAuth() auth: AuthContext,
  ): Promise<SystemSettingRecord> {
    return this.systemSettings.update(key, body.value, auth);
  }
}
