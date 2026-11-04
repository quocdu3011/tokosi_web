import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { PermissionCode, PermissionScope, Role } from '@kiot/shared';
import type { Request } from 'express';

/** Người dùng đã xác thực, do AuthGuard gắn vào `request.user` (vai trò đọc từ CSDL, không từ token). */
export interface AuthUser {
  id: string;
  role: Role;
}

/** Request sau khi qua xác thực, kiểm tra quyền và (nếu có) xác định chi nhánh làm việc. */
export interface AppRequest extends Request {
  user?: AuthUser;
  /** Phạm vi của các quyền mà handler đã yêu cầu (do PermissionGuard gắn). */
  grants?: Partial<Record<PermissionCode, PermissionScope>>;
  /** Chi nhánh làm việc của yêu cầu (do BranchContextGuard gắn khi handler có `@RequireBranch()`). */
  branchId?: string;
}

/** Lấy người dùng hiện tại trong controller: `me(@CurrentUser() user: AuthUser)`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const user = ctx.switchToHttp().getRequest<AppRequest>().user;
    if (!user)
      throw new Error('CurrentUser dùng trên endpoint chưa qua AuthGuard');
    return user;
  },
);

/** Lấy chi nhánh làm việc (cần `@RequireBranch()` trên handler). */
export const WorkingBranchId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const branchId = ctx.switchToHttp().getRequest<AppRequest>().branchId;
    if (!branchId)
      throw new Error('WorkingBranchId cần @RequireBranch() trên handler');
    return branchId;
  },
);
