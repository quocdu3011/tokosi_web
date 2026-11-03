import type { PermissionCode, PermissionScope, Role } from '@kiot/shared';
import type { Request } from 'express';

/** Người dùng đã xác thực, do AuthGuard (JWT) gắn vào `request.user`. */
export interface AuthUser {
  id: string;
  role: Role;
}

/** Request sau khi qua xác thực và kiểm tra quyền. */
export interface AppRequest extends Request {
  user?: AuthUser;
  /** Phạm vi của các quyền mà handler đã yêu cầu (do PermissionGuard gắn). */
  grants?: Partial<Record<PermissionCode, PermissionScope>>;
}
