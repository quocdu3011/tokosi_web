import type { AuthUser } from '@/lib/api/types';

/**
 * Kiểm tra quyền theo `permissions` của `/auth/me` (docs/api/README.md mục 8).
 * KHÔNG hard-code theo vai trò: Quản lý cấu hình quyền của từng vai trò trên hệ thống.
 */
export type Scope = 'all' | 'own';

export function can(user: Pick<AuthUser, 'permissions'> | null | undefined, code: string): boolean {
  return !!user?.permissions.some((p) => p.code === code);
}

/** Phạm vi của quyền: `all`, `own` (chỉ dữ liệu của mình) hoặc `null` nếu không có quyền. */
export function scopeOf(
  user: Pick<AuthUser, 'permissions'> | null | undefined,
  code: string,
): Scope | null {
  const grant = user?.permissions.find((p) => p.code === code);
  return grant ? (grant.scope as Scope) : null;
}

/** Có ít nhất một trong các quyền (dùng cho mục menu cha). */
export function canAny(user: Pick<AuthUser, 'permissions'> | null | undefined, codes: string[]) {
  return codes.some((c) => can(user, c));
}
