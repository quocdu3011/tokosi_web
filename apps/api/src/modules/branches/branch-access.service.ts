import { Inject, Injectable } from '@nestjs/common';
import { ADMIN_ROLE } from '@kiot/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import type { AuthUser } from '../../common/auth-user.js';
import { DB, type Database } from '../../db/database.module.js';
import { branches, userBranches, users } from '../../db/schema/index.js';

/**
 * Chi nhánh mà một người dùng được làm việc.
 * - Quản lý: mọi chi nhánh đang hoạt động.
 * - Vai trò khác: chỉ các chi nhánh được gán trong `user_branches`.
 * Mọi truy vấn dữ liệu theo chi nhánh phải đi qua đây để nhân viên chi nhánh này không thấy dữ liệu chi nhánh kia.
 */
@Injectable()
export class BranchAccessService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async allowedBranchIds(user: AuthUser): Promise<string[]> {
    if (user.role === ADMIN_ROLE) {
      const rows = await this.db
        .select({ id: branches.id })
        .from(branches)
        .where(eq(branches.isActive, true));
      return rows.map((r) => r.id);
    }
    const rows = await this.db
      .select({ id: branches.id })
      .from(userBranches)
      .innerJoin(branches, eq(branches.id, userBranches.branchId))
      .where(
        and(eq(userBranches.userId, user.id), eq(branches.isActive, true)),
      );
    return rows.map((r) => r.id);
  }

  /** Chi nhánh người dùng được phép, kèm thông tin hiển thị (sắp theo mã). */
  async listAllowed(
    user: AuthUser,
  ): Promise<
    Array<{ id: string; code: string; name: string; isDefault: boolean }>
  > {
    const ids = await this.allowedBranchIds(user);
    if (ids.length === 0) return [];
    return this.db
      .select({
        id: branches.id,
        code: branches.code,
        name: branches.name,
        isDefault: branches.isDefault,
      })
      .from(branches)
      .where(inArray(branches.id, ids))
      .orderBy(branches.code);
  }

  /** Ném 403 `BRANCH_FORBIDDEN` nếu người dùng không được phép dùng chi nhánh này. */
  async assertAccess(user: AuthUser, branchId: string): Promise<void> {
    const allowed = await this.allowedBranchIds(user);
    if (!allowed.includes(branchId)) {
      throw new AppError(
        403,
        'BRANCH_FORBIDDEN',
        'Bạn không được phép làm việc với chi nhánh này',
        {
          branchId,
        },
      );
    }
  }

  /**
   * Chi nhánh đang làm việc của một yêu cầu: header `X-Branch-Id` nếu có (phải được phép);
   * nếu không thì chi nhánh mặc định của người dùng; nếu chỉ có đúng 1 chi nhánh được phép thì dùng nó;
   * còn lại báo lỗi `BRANCH_REQUIRED`.
   */
  async resolveWorkingBranch(
    user: AuthUser,
    requestedBranchId?: string | null,
  ): Promise<string> {
    const allowed = await this.allowedBranchIds(user);
    if (requestedBranchId) {
      if (!allowed.includes(requestedBranchId)) {
        throw new AppError(
          403,
          'BRANCH_FORBIDDEN',
          'Bạn không được phép làm việc với chi nhánh này',
          {
            branchId: requestedBranchId,
          },
        );
      }
      return requestedBranchId;
    }
    const [row] = await this.db
      .select({ defaultBranchId: users.defaultBranchId })
      .from(users)
      .where(eq(users.id, user.id));
    if (row?.defaultBranchId && allowed.includes(row.defaultBranchId))
      return row.defaultBranchId;
    if (allowed.length === 1) return allowed[0] as string;
    throw new AppError(
      400,
      'BRANCH_REQUIRED',
      'Cần chọn chi nhánh làm việc (header X-Branch-Id)',
    );
  }

  /** Gán danh sách chi nhánh cho một người dùng (thay thế toàn bộ). */
  async setUserBranches(userId: string, branchIds: string[]): Promise<void> {
    const unique = [...new Set(branchIds)];
    if (unique.length > 0) {
      const found = await this.db
        .select({ id: branches.id })
        .from(branches)
        .where(inArray(branches.id, unique));
      if (found.length !== unique.length) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Có chi nhánh không tồn tại',
        );
      }
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(userBranches).where(eq(userBranches.userId, userId));
      if (unique.length > 0) {
        await tx
          .insert(userBranches)
          .values(unique.map((branchId) => ({ userId, branchId })));
      }
    });
  }
}
