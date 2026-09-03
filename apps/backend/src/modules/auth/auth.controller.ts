import { Controller, Post, Get, Body, HttpCode, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto, RefreshDto } from './dto/refresh.dto';

// Tighter limit than the app-wide default to slow down credential
// stuffing / brute-force attempts against these two endpoints.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
// Refresh is called once per access-token lifetime per client; 10/min
// leaves room for a few tabs without opening a token-guessing channel
// (256-bit random tokens make guessing pointless anyway).
const REFRESH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

type Req = { user: { id: string }; ip?: string };

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Throttle(AUTH_THROTTLE)
  @Post('register')
  async register(@Request() req: { ip?: string }, @Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto, req.ip ?? null);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('login')
  async login(@Request() req: { ip?: string }, @Body() loginDto: LoginDto) {
    return this.authService.login(loginDto, req.ip ?? null);
  }

  // Rotates the refresh token and issues a new access token (ADR-26). No
  // JWT guard: the access token is typically expired when this is called.
  @Throttle(REFRESH_THROTTLE)
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Request() req: { ip?: string }, @Body() body: RefreshDto) {
    return this.authService.refresh(body.refresh_token, req.ip ?? null);
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(AuthGuard('jwt'))
  async logout(@Request() req: Req, @Body() body: LogoutDto) {
    return this.authService.logout(req.user.id, body.refresh_token, body.all === true, req.ip ?? null);
  }

  @Get('profile')
  @UseGuards(AuthGuard('jwt'))
  async getProfile(@Request() req: Req) {
    return this.authService.getProfile(req.user.id);
  }
}
