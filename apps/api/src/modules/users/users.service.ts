import { Inject, Injectable } from '@nestjs/common';
import { ADMIN_ROLE, USER_CODE_PREFIX, normalizeVnPhone } from '@kiot/shared';
import { and, count, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import { uniqueViolation } from '../../common/pg-errors.js';
import type { AuthUser } from '../../common/auth-user.js';
import { generatePassword, hashPassword } from '../../common/password.js';
import { passwordProblems } from '../../common/password-policy.js';
import { DB, type Database, type Tx } from '../../db/database.module.js';
import { nextDocumentCode } from '../../db/code-sequence.js';
import { searchWhere } from '../../db/search.js';
import { branches, userBranches, users } from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService, type RequestContext } from '../auth/auth.service.js';
import {
  USERNAME_PATTERN,
  type CreateUserDto,
  type ListUsersQueryDto,
  type ResetPasswordDto,
  type SetUserBranchesDto,
  type UpdateUserDto,
  type UserDto,
  type UserWithPasswordDto,
} from './users.dto.js';

type UserRow = typeof users.$inferSelect;

/** Biểu thức tìm không dấu trên mã, tên đăng nhập, họ tên, SĐT (bảng nhỏ nên không cần chỉ mục). */
const userSearchExpr = sql`f_search_text(concat_ws(' ', ${users.code}, ${users.username}, ${users.fullName}, ${users.phone}))`;

/**
 * Quản lý người dùng (chỉ Quản lý, quyền `user.manage`). Quy tắc an toàn:
 *  - không có xóa: khóa tài khoản bằng `isActive = false` (thu hồi mọi phiên đăng nhập ngay);
 *  - không tự khóa mình, không tự đổi vai trò của mình, không khóa/hạ Quản lý hoạt động cuối cùng;
 *  - tài khoản mới và tài khoản vừa đặt lại mật khẩu bị bắt đổi mật khẩu ở lần đăng nhập kế tiếp;
 *  - mật khẩu không bao giờ vào nhật ký; mật khẩu tạm do hệ thống sinh chỉ trả về đúng một lần.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly auth: AuthService,
    private readonly auditLog: AuditService,
  ) {}

  async list(query: ListUsersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const conditions: Array<SQL | undefined> = [
      isNull(users.deletedAt),
      searchWhere(userSearchExpr, query.q),
      query.role ? eq(users.role, query.role) : undefined,
      query.isActive === undefined
        ? undefined
        : eq(users.isActive, query.isActive),
    ];
    const where = and(...conditions);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(users)
      .where(where);
    const rows = await this.db
      .select()
      .from(users)
      .where(where)
      .orderBy(users.code)
      .limit(limit)
      .offset((page - 1) * limit);
    const branchMap = await this.branchIdsOf(rows.map((r) => r.id));
    return {
      data: rows.map((r) => this.toDto(r, branchMap.get(r.id) ?? [])),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async get(id: string): Promise<UserDto> {
    const row = await this.findOrThrow(this.db, id);
    return this.toDto(row, (await this.branchIdsOf([id])).get(id) ?? []);
  }

  async create(
    actor: AuthUser,
    input: CreateUserDto,
    ctx: RequestContext,
  ): Promise<UserWithPasswordDto> {
    const username = input.username.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(username)) {
      throw this.invalid(
        'username',
        'Tên đăng nhập gồm chữ thường không dấu, số, "." "_" "-", dài 3–32 ký tự',
      );
    }
    const phone = this.parsePhone(input.phone) ?? null;
    const branchIds = [...new Set(input.branchIds)];
    await this.assertBranchesActive(this.db, branchIds);
    if (input.role !== ADMIN_ROLE && branchIds.length === 0) {
      throw this.invalid(
        'branchIds',
        'Phải gán ít nhất một chi nhánh cho vai trò này',
      );
    }
    if (input.defaultBranchId && !branchIds.includes(input.defaultBranchId)) {
      throw this.invalid(
        'defaultBranchId',
        'Chi nhánh mặc định phải nằm trong danh sách chi nhánh được gán',
      );
    }

    let temporaryPassword: string | undefined;
    let password = input.password;
    if (password === undefined) {
      password = temporaryPassword = generatePassword();
    } else {
      const problems = passwordProblems(password, {
        username,
        field: 'password',
      });
      if (problems.length > 0) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          problems[0]!.message,
          problems,
        );
      }
    }
    const passwordHash = await hashPassword(password);

    const created = await this.db
      .transaction(async (tx) => {
        const [dup] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.username, username));
        if (dup) this.throwDuplicate(username);
        const [row] = await tx
          .insert(users)
          .values({
            code: await nextDocumentCode(tx, USER_CODE_PREFIX),
            username,
            fullName: input.fullName.trim(),
            passwordHash,
            mustChangePassword: true,
            role: input.role,
            phone,
            defaultBranchId: input.defaultBranchId ?? null,
          })
          .returning();
        if (branchIds.length > 0) {
          await tx
            .insert(userBranches)
            .values(
              branchIds.map((branchId) => ({ userId: row!.id, branchId })),
            );
        }
        await this.audit(
          tx,
          actor.id,
          'user.create',
          row!.id,
          null,
          {
            username,
            role: input.role,
            branchIds,
          },
          ctx,
        );
        return row!;
      })
      .catch((e: unknown) => {
        const violated = uniqueViolation(e);
        if (!violated) throw e;
        // Bộ đếm mã lệch (vd sau khi import người dùng có sẵn mã) khác với trùng tên đăng nhập
        if (violated.constraint?.includes('code')) {
          throw new AppError(
            409,
            'DUPLICATE_CODE',
            'Mã nhân viên được cấp đã tồn tại (bộ đếm mã bị lệch). Hãy báo quản trị hệ thống.',
          );
        }
        this.throwDuplicate(username);
      });
    const result: UserWithPasswordDto = this.toDto(created, branchIds);
    if (temporaryPassword) result.temporaryPassword = temporaryPassword;
    return result;
  }

  async update(
    actor: AuthUser,
    id: string,
    input: UpdateUserDto,
    ctx: RequestContext,
  ): Promise<UserDto> {
    return this.db.transaction(async (tx) => {
      const phone = this.parsePhone(input.phone);
      const before = await this.findOrThrow(tx, id);
      const isSelf = before.id === actor.id;
      const nextRole = input.role ?? before.role;
      const nextActive = input.isActive ?? before.isActive;

      if (isSelf && input.role !== undefined && input.role !== before.role) {
        throw this.invalidState('Không thể đổi vai trò của chính mình');
      }
      if (isSelf && input.isActive === false) {
        throw this.invalidState('Không thể tự khóa tài khoản của mình');
      }
      const losesManager =
        before.role === ADMIN_ROLE &&
        before.isActive &&
        (nextRole !== ADMIN_ROLE || !nextActive);
      if (losesManager) await this.assertAnotherManager(tx, before.id);

      const currentBranchIds = (await this.branchIdsOf([id], tx)).get(id) ?? [];
      if (nextRole !== ADMIN_ROLE && currentBranchIds.length === 0) {
        throw this.invalid(
          'role',
          'Gán ít nhất một chi nhánh cho người dùng trước khi đổi sang vai trò này',
        );
      }
      if (input.defaultBranchId) {
        await this.assertBranchesActive(tx, [input.defaultBranchId]);
        if (
          nextRole !== ADMIN_ROLE &&
          !currentBranchIds.includes(input.defaultBranchId)
        ) {
          throw this.invalid(
            'defaultBranchId',
            'Chi nhánh mặc định phải nằm trong danh sách chi nhánh được gán',
          );
        }
      }

      const patch: Partial<typeof users.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (input.fullName !== undefined) patch.fullName = input.fullName.trim();
      if (phone !== undefined) patch.phone = phone;
      if (input.role !== undefined) patch.role = input.role;
      if (input.isActive !== undefined) patch.isActive = input.isActive;
      if (input.defaultBranchId !== undefined) {
        patch.defaultBranchId = input.defaultBranchId;
      }
      const [after] = await tx
        .update(users)
        .set(patch)
        .where(eq(users.id, id))
        .returning();

      if (before.isActive && !after!.isActive) {
        await this.auth.revokeAllSessions(id, 'admin', tx);
      }
      await this.audit(
        tx,
        actor.id,
        'user.update',
        id,
        this.auditView(before),
        this.auditView(after!),
        ctx,
      );
      return this.toDto(after!, currentBranchIds);
    });
  }

  async resetPassword(
    actor: AuthUser,
    id: string,
    input: ResetPasswordDto,
    ctx: RequestContext,
  ): Promise<{ temporaryPassword?: string }> {
    const target = await this.findOrThrow(this.db, id);
    if (target.id === actor.id) {
      throw this.invalidState(
        'Hãy dùng chức năng đổi mật khẩu cho tài khoản của chính mình',
      );
    }
    let temporaryPassword: string | undefined;
    let password = input.newPassword;
    if (password === undefined) {
      password = temporaryPassword = generatePassword();
    } else {
      const problems = passwordProblems(password, {
        username: target.username,
        field: 'newPassword',
      });
      if (problems.length > 0) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          problems[0]!.message,
          problems,
        );
      }
    }
    const passwordHash = await hashPassword(password);
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, mustChangePassword: true, updatedAt: new Date() })
        .where(eq(users.id, id));
      await this.auth.revokeAllSessions(id, 'admin', tx);
      await this.audit(
        tx,
        actor.id,
        'user.reset_password',
        id,
        null,
        null,
        ctx,
      );
    });
    return temporaryPassword ? { temporaryPassword } : {};
  }

  async setBranches(
    actor: AuthUser,
    id: string,
    input: SetUserBranchesDto,
    ctx: RequestContext,
  ): Promise<UserDto> {
    return this.db.transaction(async (tx) => {
      const user = await this.findOrThrow(tx, id);
      const branchIds = [...new Set(input.branchIds)];
      await this.assertBranchesActive(tx, branchIds);
      if (user.role !== ADMIN_ROLE && branchIds.length === 0) {
        throw this.invalid(
          'branchIds',
          'Phải gán ít nhất một chi nhánh cho vai trò này',
        );
      }
      const requestedDefault =
        input.defaultBranchId === undefined
          ? user.defaultBranchId
          : input.defaultBranchId;
      if (input.defaultBranchId && !branchIds.includes(input.defaultBranchId)) {
        throw this.invalid(
          'defaultBranchId',
          'Chi nhánh mặc định phải nằm trong danh sách chi nhánh được gán',
        );
      }
      // Quản lý làm việc được ở mọi chi nhánh nên giữ nguyên; vai trò khác mà mặc định không còn được gán thì bỏ
      const keepDefault =
        requestedDefault !== null &&
        (user.role === ADMIN_ROLE || branchIds.includes(requestedDefault));
      const before = (await this.branchIdsOf([id], tx)).get(id) ?? [];

      await tx.delete(userBranches).where(eq(userBranches.userId, id));
      if (branchIds.length > 0) {
        await tx
          .insert(userBranches)
          .values(branchIds.map((branchId) => ({ userId: id, branchId })));
      }
      const [after] = await tx
        .update(users)
        .set({
          defaultBranchId: keepDefault ? requestedDefault : null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning();
      await this.audit(
        tx,
        actor.id,
        'user.set_branches',
        id,
        { branchIds: before },
        { branchIds },
        ctx,
      );
      return this.toDto(after!, branchIds);
    });
  }

  // ------------------------------------------------------------------ nội bộ

  private async findOrThrow(
    db: Pick<Database, 'select'>,
    id: string,
  ): Promise<UserRow> {
    const [row] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)));
    if (!row) {
      throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy người dùng');
    }
    return row;
  }

  private async branchIdsOf(
    userIds: string[],
    db: Pick<Database, 'select'> = this.db,
  ): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (userIds.length === 0) return map;
    const rows = await db
      .select({ userId: userBranches.userId, branchId: userBranches.branchId })
      .from(userBranches)
      .where(inArray(userBranches.userId, userIds))
      .orderBy(userBranches.branchId);
    for (const r of rows) {
      const list = map.get(r.userId) ?? [];
      list.push(r.branchId);
      map.set(r.userId, list);
    }
    return map;
  }

  private async assertBranchesActive(
    db: Pick<Database, 'select'>,
    branchIds: string[],
  ): Promise<void> {
    if (branchIds.length === 0) return;
    const found = await db
      .select({ id: branches.id })
      .from(branches)
      .where(and(inArray(branches.id, branchIds), eq(branches.isActive, true)));
    const ok = new Set(found.map((b) => b.id));
    const missing = branchIds.filter((b) => !ok.has(b));
    if (missing.length > 0) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Có chi nhánh không tồn tại hoặc đã ngừng hoạt động',
        missing.map((branchId) => ({
          field: 'branchIds',
          message: 'Chi nhánh không tồn tại hoặc đã ngừng hoạt động',
          branchId,
        })),
      );
    }
  }

  /**
   * Phải còn ít nhất một Quản lý hoạt động khác, nếu không hệ thống không còn ai phân quyền được.
   * Khóa dòng (FOR UPDATE) của MỌI Quản lý hoạt động — kể cả người bị sửa — và luôn theo thứ tự `id`:
   * nhờ vậy hai Quản lý khóa nhau cùng lúc xếp hàng tuần tự thay vì bế tắc (deadlock → lỗi 500), và bên
   * sau thấy kết quả của bên trước.
   */
  private async assertAnotherManager(tx: Tx, exceptId: string): Promise<void> {
    const managers = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.role, ADMIN_ROLE),
          eq(users.isActive, true),
          isNull(users.deletedAt),
        ),
      )
      .orderBy(users.id)
      .for('update');
    if (!managers.some((m) => m.id !== exceptId)) {
      throw this.invalidState(
        'Không thể khóa hoặc hạ vai trò Quản lý hoạt động cuối cùng',
      );
    }
  }

  private toDto(row: UserRow, branchIds: string[]): UserDto {
    return {
      id: row.id,
      code: row.code,
      username: row.username,
      fullName: row.fullName,
      role: row.role,
      phone: row.phone,
      isActive: row.isActive,
      mustChangePassword: row.mustChangePassword,
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      defaultBranchId: row.defaultBranchId,
      branchIds,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Chỉ các trường an toàn để ghi nhật ký (không có băm mật khẩu). */
  private auditView(row: UserRow) {
    return {
      fullName: row.fullName,
      phone: row.phone,
      role: row.role,
      isActive: row.isActive,
      defaultBranchId: row.defaultBranchId,
    };
  }

  private async audit(
    tx: Tx,
    actorId: string,
    action: string,
    entityId: string,
    before: unknown,
    after: unknown,
    ctx: RequestContext,
  ): Promise<void> {
    await this.auditLog.record(tx, {
      userId: actorId,
      action,
      entityType: 'user',
      entityId,
      before,
      after,
      ip: ctx.ip ?? null,
    });
  }

  /** undefined = không đổi; null hoặc rỗng = xóa; còn lại phải là số điện thoại Việt Nam hợp lệ (đã chuẩn hóa). */
  private parsePhone(
    value: string | null | undefined,
  ): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value.trim() === '') return null;
    const normalized = normalizeVnPhone(value);
    if (!normalized) {
      throw this.invalid(
        'phone',
        'Số điện thoại không hợp lệ (10–11 chữ số, bắt đầu bằng 0 hoặc +84)',
      );
    }
    return normalized;
  }

  private invalid(field: string, message: string): AppError {
    return new AppError(400, 'VALIDATION_ERROR', message, [{ field, message }]);
  }

  private invalidState(message: string): AppError {
    return new AppError(400, 'INVALID_STATE', message);
  }

  private throwDuplicate(username: string): never {
    throw new AppError(
      409,
      'DUPLICATE_USERNAME',
      `Tên đăng nhập "${username}" đã được dùng`,
      [{ field: 'username', message: 'Tên đăng nhập đã được dùng' }],
    );
  }
}
