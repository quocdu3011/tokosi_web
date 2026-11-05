import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getPermissionDef, type PermissionCode } from '@kiot/shared';
import { AppError } from '../../common/app-error.js';
import type { AppRequest } from '../../common/auth-user.js';
import { PermissionsService } from './permissions.service.js';
import {
  ANY_PERMISSIONS_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from './require-permission.decorator.js';

/**
 * Kiểm tra `@RequirePermission(...)`. Endpoint không gắn decorator thì cho qua
 * (việc bắt buộc đăng nhập do AuthGuard đảm nhiệm và phải chạy TRƯỚC guard này).
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<
      PermissionCode[] | undefined
    >(REQUIRED_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    const anyOf = this.reflector.getAllAndOverride<
      PermissionCode[] | undefined
    >(ANY_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if ((!required || required.length === 0) && (!anyOf || anyOf.length === 0))
      return true;

    const request = context.switchToHttp().getRequest<AppRequest>();
    const user = request.user;
    if (!user) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Bạn cần đăng nhập');
    }

    const grants: NonNullable<AppRequest['grants']> = {};
    for (const code of required ?? []) {
      const grant = await this.permissions.getGrant(user.role, code);
      if (!grant) {
        const label = getPermissionDef(code)?.label ?? code;
        throw new AppError(403, 'FORBIDDEN', `Bạn không có quyền: ${label}`, {
          permission: code,
        });
      }
      grants[code] = grant.scope;
    }
    if (anyOf && anyOf.length > 0) {
      for (const code of anyOf) {
        const grant = await this.permissions.getGrant(user.role, code);
        if (grant) grants[code] = grant.scope;
      }
      if (!anyOf.some((code) => grants[code] !== undefined)) {
        const labels = anyOf.map((c) => getPermissionDef(c)?.label ?? c);
        throw new AppError(
          403,
          'FORBIDDEN',
          `Bạn không có quyền: ${labels.join(' hoặc ')}`,
          { anyOf },
        );
      }
    }
    request.grants = { ...request.grants, ...grants };
    return true;
  }
}
