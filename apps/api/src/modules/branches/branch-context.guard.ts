import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../../common/app-error.js';
import type { AppRequest } from '../../common/auth-user.js';
import { currentContext } from '../../common/request-context.js';
import { BranchAccessService } from './branch-access.service.js';
import { REQUIRE_BRANCH_KEY } from './require-branch.decorator.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Xác định chi nhánh làm việc cho handler có `@RequireBranch()`. Chạy SAU AuthGuard. */
@Injectable()
export class BranchContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly branchAccess: BranchAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(
      REQUIRE_BRANCH_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const request = context.switchToHttp().getRequest<AppRequest>();
    if (!request.user)
      throw new AppError(401, 'UNAUTHENTICATED', 'Bạn cần đăng nhập');

    const raw = request.headers['x-branch-id'];
    const requested = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (requested && !UUID.test(requested)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'X-Branch-Id không hợp lệ', [
        { field: 'X-Branch-Id', message: 'Phải là UUID của chi nhánh' },
      ]);
    }
    request.branchId = await this.branchAccess.resolveWorkingBranch(
      request.user,
      requested,
    );
    const ctx = currentContext();
    if (ctx) ctx.branchId = request.branchId;
    return true;
  }
}
