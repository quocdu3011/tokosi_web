import { Inject, Injectable } from '@nestjs/common';
import {
  ADMIN_ROLE,
  PERMISSION_CODES,
  ROLES,
  defaultGrantsFor,
  isPermissionCode,
  normalizeGrants,
  type Grant,
  type NormalizeResult,
  type PermissionCode,
  type PermissionScope,
  type Role,
  type UserRole,
  PENDING_ROLE,
} from '@kiot/shared';
import { count, eq } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import { DB, type Database } from '../../db/database.module.js';
import { auditLogs, rolePermissions, users } from '../../db/schema/index.js';

export interface RoleSummary {
  role: Role;
  locked: boolean;
  permissionCount: number;
  userCount: number;
}

export interface SetGrantsResult extends NormalizeResult {
  role: Role;
}

/**
 * Quyền của từng vai trò, đọc từ bảng `role_permissions` (Quản lý chỉnh được).
 * Vai trò `manager` luôn có mọi quyền và không lưu trong bảng.
 * Có bộ nhớ đệm trong tiến trình; mọi thay đổi đều làm mới đệm ngay.
 * (Nếu sau này chạy nhiều bản API cùng lúc thì cần đổi sang đệm dùng chung/phát sự kiện.)
 */
@Injectable()
export class PermissionsService {
  private readonly cache = new Map<Role, Grant[]>();

  constructor(@Inject(DB) private readonly db: Database) {}

  /** Danh sách quyền đang có của một vai trò (đã sắp theo danh mục). */
  async getGrants(role: UserRole): Promise<Grant[]> {
    // Tài khoản chờ cấp quyền: không có quyền nào, bất kể dữ liệu trong role_permissions
    if (role === PENDING_ROLE) return [];
    if (role === ADMIN_ROLE) return defaultGrantsFor(ADMIN_ROLE);
    const cached = this.cache.get(role);
    if (cached) return cached;

    const rows = await this.db
      .select({
        code: rolePermissions.permissionCode,
        scope: rolePermissions.scope,
      })
      .from(rolePermissions)
      .where(eq(rolePermissions.role, role));
    const byCode = new Map(rows.map((r) => [r.code, r.scope]));
    // Bỏ qua mã còn sót trong CSDL nhưng đã bị xóa khỏi danh mục.
    const grants = PERMISSION_CODES.filter((c) => byCode.has(c)).map(
      (code) => ({
        code,
        scope: byCode.get(code) as PermissionScope,
      }),
    );
    this.cache.set(role, grants);
    return grants;
  }

  async getGrant(
    role: UserRole,
    code: PermissionCode,
  ): Promise<Grant | undefined> {
    return (await this.getGrants(role)).find((g) => g.code === code);
  }

  /** Vai trò có quyền này không (Quản lý luôn có). Dùng để ẩn trường nhạy cảm như giá vốn khỏi phản hồi. */
  async has(role: UserRole, code: PermissionCode): Promise<boolean> {
    return (await this.getGrant(role, code)) !== undefined;
  }

  /** Thay toàn bộ quyền của một vai trò. Trả về bộ quyền cuối cùng sau chuẩn hóa. */
  async setGrants(
    role: Role,
    input: ReadonlyArray<{ code: string; scope?: PermissionScope }>,
    actorId: string | null = null,
  ): Promise<SetGrantsResult> {
    this.assertEditable(role);
    const normalized = normalizeGrants(role, input);
    if (normalized.unknown.length > 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Có mã quyền không tồn tại', {
        unknown: normalized.unknown,
      });
    }
    if (normalized.lockedRejected.length > 0) {
      throw new AppError(
        400,
        'PERMISSION_LOCKED',
        'Quyền này chỉ dành cho Quản lý, không thể cấp cho vai trò khác',
        { locked: normalized.lockedRejected },
      );
    }
    await this.replaceGrants(
      role,
      normalized.grants,
      actorId,
      'role.permissions.update',
    );
    return { role, ...normalized };
  }

  /** Khôi phục cấu hình mặc định (đề xuất ban đầu) của một vai trò. */
  async resetToDefaults(
    role: Role,
    actorId: string | null = null,
  ): Promise<SetGrantsResult> {
    this.assertEditable(role);
    const grants = defaultGrantsFor(role);
    await this.replaceGrants(role, grants, actorId, 'role.permissions.reset');
    return { role, grants, autoAdded: [], unknown: [], lockedRejected: [] };
  }

  /** Khởi tạo quyền mặc định khi bảng còn trống (lần cài đặt đầu). Trả về số dòng đã thêm. */
  async seedDefaultsIfEmpty(): Promise<number> {
    const [{ n }] = await this.db.select({ n: count() }).from(rolePermissions);
    if (n > 0) return 0;
    let inserted = 0;
    for (const role of ROLES) {
      if (role === ADMIN_ROLE) continue;
      const grants = defaultGrantsFor(role);
      if (grants.length === 0) continue;
      await this.db
        .insert(rolePermissions)
        .values(
          grants.map((g) => ({ role, permissionCode: g.code, scope: g.scope })),
        );
      inserted += grants.length;
    }
    this.cache.clear();
    return inserted;
  }

  async listRoleSummaries(): Promise<RoleSummary[]> {
    const userCounts = await this.db
      .select({ role: users.role, n: count() })
      .from(users)
      .groupBy(users.role);
    const counts = new Map(userCounts.map((r) => [r.role, r.n]));
    return Promise.all(
      ROLES.map(async (role) => ({
        role,
        locked: role === ADMIN_ROLE,
        permissionCount: (await this.getGrants(role)).length,
        userCount: counts.get(role) ?? 0,
      })),
    );
  }

  /** Dùng trong test hoặc khi biết dữ liệu bị sửa ngoài ứng dụng. */
  clearCache(): void {
    this.cache.clear();
  }

  private assertEditable(role: Role): void {
    if (role === ADMIN_ROLE) {
      throw new AppError(
        409,
        'ROLE_LOCKED',
        'Vai trò Quản lý luôn có đầy đủ quyền và không thể chỉnh sửa',
      );
    }
  }

  private async replaceGrants(
    role: Role,
    grants: Grant[],
    actorId: string | null,
    action: string,
  ): Promise<void> {
    const before = await this.getGrants(role);
    await this.db.transaction(async (tx) => {
      await tx.delete(rolePermissions).where(eq(rolePermissions.role, role));
      if (grants.length > 0) {
        await tx.insert(rolePermissions).values(
          grants.map((g) => ({
            role,
            permissionCode: g.code,
            scope: g.scope,
            updatedBy: actorId,
          })),
        );
      }
      await tx.insert(auditLogs).values({
        userId: actorId,
        action,
        entityType: `role_permissions:${role}`,
        before,
        after: grants,
      });
    });
    this.cache.delete(role);
  }
}

export { isPermissionCode };
