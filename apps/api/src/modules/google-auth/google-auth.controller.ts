import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  type AppRequest,
  type AuthUser,
  CurrentUser,
} from '../../common/auth-user.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { Public } from '../auth/auth.decorators.js';
import { SessionResponseDto } from '../auth/auth.dto.js';
import type { RequestContext, Session } from '../auth/auth.service.js';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from '../auth/cookies.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import { AuthSettingsService } from './auth-settings.service.js';
import {
  AuthSettingsDto,
  GoogleLoginDto,
  GoogleSignupDto,
  GoogleSignupRequiredDto,
  UpdateAuthSettingsDto,
} from './google-auth.dto.js';
import { GoogleAuthService } from './google-auth.service.js';

@ApiTags('Xác thực')
@Controller('auth/google')
export class GoogleAuthController {
  constructor(
    private readonly google: GoogleAuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Đăng nhập bằng Google (qua Supabase)',
    description:
      'Gửi access token Supabase sau khi đăng nhập Google. Đã có tài khoản → 200 như `/auth/login` (cookie refresh + access token). ' +
      'Chưa có tài khoản: nếu Quản lý cho phép tự đăng ký và tên miền email được phép → 202 `signup_required` kèm `signupToken` ' +
      '(chưa tạo gì); ngược lại 403 `SIGNUP_DISABLED`.',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  async login(
    @Body() body: GoogleLoginDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponseDto | GoogleSignupRequiredDto> {
    const result = await this.google.login(body.accessToken, this.ctx(req));
    if (result.kind === 'signup_required') {
      res.status(202);
      return {
        status: 'signup_required',
        signupToken: result.signupToken,
        email: result.email,
        suggestedName: result.suggestedName,
      };
    }
    this.setRefreshCookie(res, result.session);
    return {
      accessToken: result.session.accessToken,
      expiresIn: result.session.expiresIn,
      user: result.user,
    };
  }

  @Public()
  @Post('signup')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Hoàn tất đăng ký tài khoản từ Google',
    description:
      'Tạo tài khoản nội bộ (tên đăng nhập + mật khẩu + họ tên + SĐT) và đăng nhập luôn. Tài khoản mới có vai trò `pending`: ' +
      'KHÔNG có quyền nào và không có chi nhánh cho tới khi Quản lý cấp. Mỗi tài khoản Google đăng ký được một lần.',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  async signup(
    @Body() body: GoogleSignupDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponseDto> {
    const { session, user } = await this.google.signup(body, this.ctx(req));
    this.setRefreshCookie(res, session);
    return {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      user,
    };
  }

  private ctx(req: AppRequest): RequestContext {
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
}

@ApiTags('Cài đặt')
@ApiBearerAuth()
@Controller('settings/auth')
export class AuthSettingsController {
  constructor(private readonly settings: AuthSettingsService) {}

  @Get()
  @RequirePermission('user.manage')
  @ApiOperation({ summary: 'Cài đặt tự đăng ký bằng Google' })
  @ApiOkResponse({ type: AuthSettingsDto })
  get(): Promise<AuthSettingsDto> {
    return this.settings.get();
  }

  @Patch()
  @RequirePermission('user.manage')
  @ApiOperation({
    summary: 'Bật/tắt tự đăng ký bằng Google và đặt tên miền email được phép',
    description:
      'Mặc định tắt. Bật mà chưa có tên miền nào → 400. Ghi nhật ký giá trị trước và sau.',
  })
  @ApiOkResponse({ type: AuthSettingsDto })
  update(
    @CurrentUser() user: AuthUser,
    @Body() body: UpdateAuthSettingsDto,
  ): Promise<AuthSettingsDto> {
    return this.settings.update(user.id, body);
  }
}
