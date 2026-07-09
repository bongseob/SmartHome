import { Body, Controller, Post } from "@nestjs/common";
import { Public } from "../auth/auth.decorators.js";
import { AuthService, type LoginRequest, type RefreshRequest } from "../services/auth.service.js";

@Controller("api/v1/auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  login(@Body() body: LoginRequest): Promise<unknown> {
    return this.auth.login(body);
  }

  @Public()
  @Post("refresh")
  refresh(@Body() body: RefreshRequest): Promise<unknown> {
    return this.auth.refresh(body);
  }

  @Public()
  @Post("logout")
  logout(@Body() body: RefreshRequest): Promise<unknown> {
    return this.auth.logout(body);
  }
}
