import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, isNull } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import type { AppRequest } from '../../common/auth-user.js';
import { DB, type Database } from '../../db/database.module.js';
import { users } from '../../db/schema/index.js';
import {
  ALLOW_PENDING_PASSWORD_KEY,
  IS_PUBLIC_KEY,
} from './auth.decorators.js';
import { TokenService } from './token.service.js';

/**
 * Bắt buộc đăng nhập cho mọi endpoint trừ khi gắn `@Public()`.
 * Xác minh access token rồi ĐỌC LẠI người dùng từ CSDL ở mỗi yêu cầu: tài khoản bị khóa/xóa hoặc đổi vai trò
 * có hiệu lực ngay, không phải chờ token hết hạn.
 *
 * Phải chạy TRƯỚC PermissionGuard và BranchContextGuard (xem AuthModule).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (
      this.reflector.getAllAndOverride<boolean | undefined>(
        IS_PUBLIC_KEY,
        targets,
      )
    )
      return true;

    const request = context.switchToHttp().getRequest<AppRequest>();
    const header = request.headers.authorization;
    const match =
      typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    if (!match) throw new AppError(401, 'UNAUTHENTICATED', 'Bạn cần đăng nhập');

    const userId = await this.tokens.verifyAccessToken(match[1] as string);
    const [user] = await this.db
      .select({
        id: users.id,
        role: users.role,
        isActive: users.isActive,
        mustChangePassword: users.mustChangePassword,
      })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)));
    if (!user || !user.isActive) {
      throw new AppError(
        401,
        'UNAUTHENTICATED',
        'Tài khoản không còn hoạt động',
      );
    }

    if (
      user.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean | undefined>(
        ALLOW_PENDING_PASSWORD_KEY,
        targets,
      )
    ) {
      throw new AppError(
        403,
        'PASSWORD_CHANGE_REQUIRED',
        'Bạn cần đổi mật khẩu trước khi tiếp tục',
      );
    }

    request.user = { id: user.id, role: user.role };
    return true;
  }
}
