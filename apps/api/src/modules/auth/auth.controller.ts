import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  type AppRequest,
  type AuthUser,
  CurrentUser,
} from '../../common/auth-user.js';
import { Inject } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { AllowPendingPasswordChange, Public } from './auth.decorators.js';
import {
  AuthUserDto,
  ChangePasswordDto,
  LoginDto,
  RefreshResponseDto,
  SessionResponseDto,
} from './auth.dto.js';
import {
  AuthService,
  type RequestContext,
  type Session,
} from './auth.service.js';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH, readCookie } from './cookies.js';

@ApiTags('Xác thực')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Đăng nhập',
    description:
      'Trả access token (JWT) trong body; refresh token nằm trong cookie httpOnly `refresh_token` (frontend không đọc được). ' +
      'Sai tài khoản hoặc mật khẩu luôn trả cùng một thông báo. Sai quá nhiều lần → 429.',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiUnauthorizedResponse({
    description: '`UNAUTHENTICATED`: sai tên đăng nhập hoặc mật khẩu',
  })
  @ApiTooManyRequestsResponse({
    description: '`RATE_LIMITED`: đăng nhập sai quá nhiều lần',
  })
  async login(
    @Body() body: LoginDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponseDto> {
    const { session, user } = await this.auth.login(body, this.contextOf(req));
    this.setRefreshCookie(res, session);
    return {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      user,
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Lấy access token mới',
    description:
      'Dùng cookie `refresh_token` (trình duyệt tự gửi, cần `credentials: include`). Mỗi lần gọi thu hồi refresh token cũ và cấp cái mới (xoay vòng).',
  })
  @ApiOkResponse({ type: RefreshResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Cookie thiếu/hết hạn/đã thu hồi → về trang đăng nhập',
  })
  async refresh(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshResponseDto> {
    try {
      const session = await this.auth.refresh(
        readCookie(req.headers.cookie, REFRESH_COOKIE),
        this.contextOf(req),
      );
      this.setRefreshCookie(res, session);
      return { accessToken: session.accessToken, expiresIn: session.expiresIn };
    } catch (error) {
      this.clearRefreshCookie(res);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Đăng xuất (thu hồi phiên hiện tại, xóa cookie)' })
  @ApiNoContentResponse()
  async logout(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(readCookie(req.headers.cookie, REFRESH_COOKIE));
    this.clearRefreshCookie(res);
  }

  @Get('me')
  @AllowPendingPasswordChange()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Thông tin người dùng hiện tại, quyền và chi nhánh được phép',
  })
  @ApiOkResponse({ type: AuthUserDto })
  me(@CurrentUser() user: AuthUser): Promise<AuthUserDto> {
    return this.auth.buildUserView(user.id);
  }

  @Post('change-password')
  @HttpCode(200)
  @AllowPendingPasswordChange()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Đổi mật khẩu',
    description:
      'Thu hồi MỌI phiên cũ (mọi thiết bị) và cấp phiên mới cho thiết bị đang dùng; gỡ cờ `mustChangePassword`. Trả access token mới.',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() body: ChangePasswordDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponseDto> {
    const result = await this.auth.changePassword(
      user.id,
      body,
      this.contextOf(req),
    );
    this.setRefreshCookie(res, result.session);
    return {
      accessToken: result.session.accessToken,
      expiresIn: result.session.expiresIn,
      user: result.user,
    };
  }

  // ------------------------------------------------------------------ nội bộ

  private contextOf(req: AppRequest): RequestContext {
    const ua = req.headers['user-agent'];
    return { ip: req.ip, userAgent: typeof ua === 'string' ? ua : undefined };
  }

  private setRefreshCookie(res: Response, session: Session): void {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      expires: session.refreshExpiresAt,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
    });
  }
}
