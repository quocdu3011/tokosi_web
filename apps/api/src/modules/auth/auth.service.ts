import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, lt } from 'drizzle-orm';
import type { Grant, Role } from '@kiot/shared';
import { AppError } from '../../common/app-error.js';
import {
  MIN_PASSWORD_LENGTH,
  hashPassword,
  verifyPassword,
} from '../../common/password.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { DB, type Database } from '../../db/database.module.js';
import { auditLogs, refreshTokens, users } from '../../db/schema/index.js';
import { BranchAccessService } from '../branches/branch-access.service.js';
import { PermissionsService } from '../authorization/permissions.service.js';
import { LoginThrottle } from './login-throttle.js';
import {
  TokenService,
  generateRefreshToken,
  hashRefreshToken,
} from './token.service.js';

export const MAX_PASSWORD_LENGTH = 128;
/** Trong khoảng này sau khi một refresh token bị thu hồi, dùng lại nó chỉ bị từ chối (không coi là bị đánh cắp). */
const REFRESH_REUSE_GRACE_MS = 10_000;

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

export interface AuthUserView {
  id: string;
  code: string;
  username: string;
  fullName: string;
  role: Role;
  mustChangePassword: boolean;
  permissions: Grant[];
  defaultBranchId: string | null;
  branches: Array<{ id: string; code: string; name: string }>;
}

export interface Session {
  accessToken: string;
  expiresIn: number;
  /** Refresh token thô — chỉ để đặt vào cookie httpOnly, không trả trong JSON. */
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * Xác thực: đăng nhập, làm mới token (xoay vòng + phát hiện dùng lại), đăng xuất, đổi mật khẩu.
 * Quy tắc bảo mật chính:
 *  - sai tài khoản/mật khẩu/khóa tài khoản đều trả CÙNG một thông báo, và luôn băm một mật khẩu (kể cả khi
 *    tài khoản không tồn tại) để không lộ tài khoản nào có thật qua thời gian phản hồi;
 *  - refresh token chỉ lưu bản băm; mỗi lần làm mới là thu hồi cái cũ và cấp cái mới;
 *  - dùng lại refresh token đã thu hồi (dấu hiệu bị đánh cắp) → thu hồi mọi phiên của người dùng đó.
 */
@Injectable()
export class AuthService {
  private readonly throttle: LoginThrottle;
  private dummyHash?: Promise<string>;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly tokens: TokenService,
    private readonly permissions: PermissionsService,
    private readonly branchAccess: BranchAccessService,
  ) {
    this.throttle = new LoginThrottle(
      config.loginMaxFailures,
      config.loginWindowSeconds * 1000,
    );
  }

  async login(
    input: { username: string; password: string },
    ctx: RequestContext = {},
  ): Promise<{ session: Session; user: AuthUserView }> {
    const username = input.username.trim().toLowerCase();
    const throttleKey = `${ctx.ip ?? '-'}|${username}`;
    this.throttle.assertAllowed(throttleKey);
    // Đặt trước một "suất sai" NGAY (đồng bộ, trước mọi await) rồi xóa khi đăng nhập đúng. Nếu chỉ ghi sau khi
    // băm xong thì 50 yêu cầu gửi song song đều qua được bước kiểm tra ở trên.
    this.throttle.recordFailure(throttleKey);

    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.username, username), isNull(users.deletedAt)));

    // Luôn băm/so khớp một lần để thời gian phản hồi không tiết lộ tài khoản có tồn tại hay không
    const passwordOk = await verifyPassword(
      user?.passwordHash ?? (await this.getDummyHash()),
      input.password,
    );
    if (!user || !user.isActive || !passwordOk) {
      // (suất sai đã được ghi ở đầu hàm)
      // Chỉ ghi tên đăng nhập khi tài khoản có thật: người dùng hay gõ nhầm mật khẩu vào ô tên đăng nhập
      await this.audit(user?.id ?? null, 'auth.login_failed', {
        ...(user ? { username: user.username } : {}),
        ip: ctx.ip ?? null,
      });
      throw new AppError(
        401,
        'UNAUTHENTICATED',
        'Sai tên đăng nhập hoặc mật khẩu',
      );
    }

    this.throttle.reset(throttleKey);
    await this.db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));
    await this.audit(user.id, 'auth.login', { ip: ctx.ip ?? null });
    return {
      session: await this.createSession(user.id, ctx),
      user: await this.buildUserView(user.id),
    };
  }

  /** Đổi refresh token (xoay vòng) lấy access token mới. */
  async refresh(rawToken: string, ctx: RequestContext = {}): Promise<Session> {
    if (!rawToken)
      throw new AppError(
        401,
        'UNAUTHENTICATED',
        'Phiên đăng nhập không hợp lệ',
      );
    const tokenHash = hashRefreshToken(rawToken);
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash));
    if (!row)
      throw new AppError(
        401,
        'UNAUTHENTICATED',
        'Phiên đăng nhập không hợp lệ',
      );

    if (row.revokedAt) {
      // Chỉ token đã bị XOAY VÒNG (đã đổi lấy token mới) mà còn được dùng mới đáng ngờ. Token bị thu hồi vì đăng xuất
      // hay đổi mật khẩu chỉ bị từ chối — thiết bị cũ dùng lại là chuyện bình thường, không phải bị đánh cắp.
      // Nếu vừa mới xoay vòng (hai tab làm mới cùng lúc) thì cũng chỉ từ chối; đã lâu thì đăng xuất mọi thiết bị.
      if (
        row.revokeReason === 'rotated' &&
        Date.now() - row.revokedAt.getTime() > REFRESH_REUSE_GRACE_MS
      ) {
        await this.revokeAllSessions(row.userId, 'reuse');
        await this.audit(row.userId, 'auth.refresh_reuse_detected', {
          ip: ctx.ip ?? null,
        });
      }
      throw new AppError(
        401,
        'UNAUTHENTICATED',
        'Phiên đăng nhập không hợp lệ',
      );
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Phiên đăng nhập đã hết hạn');
    }

    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, row.userId));
    if (!user || !user.isActive || user.deletedAt) {
      throw new AppError(
        401,
        'UNAUTHENTICATED',
        'Tài khoản không còn hoạt động',
      );
    }

    // Thu hồi token cũ (điều kiện revoked_at IS NULL để hai yêu cầu đồng thời chỉ một bên thắng)
    const revoked = await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokeReason: 'rotated' })
      .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    if (revoked.length === 0)
      throw new AppError(
        401,
        'UNAUTHENTICATED',
        'Phiên đăng nhập không hợp lệ',
      );

    return this.createSession(user.id, ctx);
  }

  /** Đăng xuất: thu hồi refresh token hiện tại (không báo lỗi nếu token không còn). */
  async logout(rawToken: string): Promise<void> {
    if (!rawToken) return;
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokeReason: 'logout' })
      .where(
        and(
          eq(refreshTokens.tokenHash, hashRefreshToken(rawToken)),
          isNull(refreshTokens.revokedAt),
        ),
      );
  }

  /**
   * Đổi mật khẩu. Thu hồi MỌI phiên cũ (mọi thiết bị) rồi cấp phiên mới cho thiết bị đang dùng,
   * và gỡ cờ bắt buộc đổi mật khẩu.
   */
  async changePassword(
    userId: string,
    input: { currentPassword: string; newPassword: string },
    ctx: RequestContext = {},
  ): Promise<{ session: Session; user: AuthUserView }> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId));
    if (!user || !user.isActive)
      throw new AppError(
        401,
        'UNAUTHENTICATED',
        'Tài khoản không còn hoạt động',
      );

    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Mật khẩu hiện tại không đúng',
        [{ field: 'currentPassword', message: 'Mật khẩu hiện tại không đúng' }],
      );
    }
    this.assertValidNewPassword(
      input.newPassword,
      input.currentPassword,
      user.username,
    );

    await this.db
      .update(users)
      .set({
        passwordHash: await hashPassword(input.newPassword),
        mustChangePassword: false,
      })
      .where(eq(users.id, userId));
    await this.revokeAllSessions(userId, 'password_change');
    await this.audit(userId, 'auth.password_changed', { ip: ctx.ip ?? null });
    return {
      session: await this.createSession(userId, ctx),
      user: await this.buildUserView(userId),
    };
  }

  /** Thông tin người dùng + quyền hiện tại + chi nhánh được phép (cho `GET /auth/me`). */
  async buildUserView(userId: string): Promise<AuthUserView> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId));
    if (!user)
      throw new AppError(401, 'UNAUTHENTICATED', 'Tài khoản không tồn tại');
    const authUser = { id: user.id, role: user.role };
    const branchRows = await this.branchAccess.listAllowed(authUser);
    return {
      id: user.id,
      code: user.code,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      permissions: await this.permissions.getGrants(user.role),
      defaultBranchId:
        user.defaultBranchId &&
        branchRows.some((b) => b.id === user.defaultBranchId)
          ? user.defaultBranchId
          : null,
      branches: branchRows.map((b) => ({
        id: b.id,
        code: b.code,
        name: b.name,
      })),
    };
  }

  /** Dọn refresh token đã hết hạn quá 30 ngày. Gọi định kỳ (hoặc khi khởi động). */
  async purgeExpiredSessions(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    const removed = await this.db
      .delete(refreshTokens)
      .where(lt(refreshTokens.expiresAt, cutoff))
      .returning({ id: refreshTokens.id });
    return removed.length;
  }

  // ------------------------------------------------------------------ nội bộ

  private async createSession(
    userId: string,
    ctx: RequestContext,
  ): Promise<Session> {
    const refreshToken = generateRefreshToken();
    const refreshExpiresAt = new Date(
      Date.now() + this.config.refreshTtlDays * 24 * 3600 * 1000,
    );
    await this.db.insert(refreshTokens).values({
      userId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshExpiresAt,
      userAgent: ctx.userAgent?.slice(0, 255) ?? null,
      ip: ctx.ip ?? null,
    });
    const access = await this.tokens.signAccessToken(userId);
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken,
      refreshExpiresAt,
    };
  }

  private async revokeAllSessions(
    userId: string,
    reason: 'password_change' | 'reuse',
  ): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokeReason: reason })
      .where(
        and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)),
      );
  }

  private assertValidNewPassword(
    next: string,
    current: string,
    username: string,
  ): void {
    const problems: Array<{ field: string; message: string }> = [];
    if (next.length < MIN_PASSWORD_LENGTH) {
      problems.push({
        field: 'newPassword',
        message: `Mật khẩu mới phải dài ít nhất ${MIN_PASSWORD_LENGTH} ký tự`,
      });
    } else if (next.length > MAX_PASSWORD_LENGTH) {
      problems.push({
        field: 'newPassword',
        message: `Mật khẩu mới không được dài quá ${MAX_PASSWORD_LENGTH} ký tự`,
      });
    }
    if (next === current) {
      problems.push({
        field: 'newPassword',
        message: 'Mật khẩu mới phải khác mật khẩu hiện tại',
      });
    }
    if (next.toLowerCase().includes(username.toLowerCase())) {
      problems.push({
        field: 'newPassword',
        message: 'Mật khẩu mới không được chứa tên đăng nhập',
      });
    }
    if (problems.length > 0)
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        problems[0]!.message,
        problems,
      );
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword(randomUUID());
    return this.dummyHash;
  }

  private async audit(
    userId: string | null,
    action: string,
    after: Record<string, unknown>,
  ): Promise<void> {
    await this.db.insert(auditLogs).values({
      userId,
      action,
      entityType: 'auth',
      entityId: userId,
      after,
      ip: typeof after.ip === 'string' ? after.ip : null,
    });
  }
}
