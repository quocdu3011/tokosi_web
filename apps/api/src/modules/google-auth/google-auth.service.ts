import { Inject, Injectable } from '@nestjs/common';
import { PENDING_ROLE, USER_CODE_PREFIX, normalizeVnPhone } from '@kiot/shared';
import { and, count, eq, isNull } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { AppError } from '../../common/app-error.js';
import { uniqueViolation } from '../../common/pg-errors.js';
import { hashPassword } from '../../common/password.js';
import { passwordProblems } from '../../common/password-policy.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { nextDocumentCode } from '../../db/code-sequence.js';
import { DB, type Database, type DbOrTx } from '../../db/database.module.js';
import { userIdentities, users } from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';
import { LoginThrottle } from '../auth/login-throttle.js';
import {
  AuthService,
  type AuthUserView,
  type RequestContext,
  type Session,
} from '../auth/auth.service.js';
import { USERNAME_PATTERN } from '../users/users.dto.js';
import { AuthSettingsService } from './auth-settings.service.js';
import {
  SupabaseJwtVerifier,
  type GoogleIdentity,
} from './supabase-jwt.verifier.js';

const PROVIDER = 'google';
const SIGNUP_AUDIENCE = 'kiot-google-signup';
const ISSUER = 'kiot-api';
const SIGNUP_TTL_SECONDS = 15 * 60;
/** Số tài khoản đang chờ cấp quyền tối đa cùng lúc (chống rải tài khoản rác). */
export const MAX_PENDING_ACCOUNTS = 50;
/** Số lần gọi mỗi IP trong một cửa sổ (cùng cửa sổ với giới hạn đăng nhập). */
const CALLS_PER_FAILURE = 4;

export type GoogleLoginResult =
  | { kind: 'session'; session: Session; user: AuthUserView }
  | {
      kind: 'signup_required';
      signupToken: string;
      email: string;
      suggestedName: string | null;
    };

/**
 * Đăng nhập Google (qua Supabase) + tự đăng ký có kiểm soát. Google chỉ chứng minh "bạn là ai": quyền luôn do hệ thống
 * quyết định. Người mới tạo ra có vai trò `pending` (không quyền nào, không chi nhánh) cho tới khi Quản lý cấp.
 */
@Injectable()
export class GoogleAuthService {
  private readonly throttle: LoginThrottle;
  private readonly key: Uint8Array;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly verifier: SupabaseJwtVerifier,
    private readonly settings: AuthSettingsService,
    private readonly auth: AuthService,
    private readonly auditLog: AuditService,
  ) {
    this.throttle = new LoginThrottle(
      config.loginMaxFailures * CALLS_PER_FAILURE,
      config.loginWindowSeconds * 1000,
    );
    this.key = new TextEncoder().encode(config.jwtAccessSecret);
  }

  async login(
    accessToken: string,
    ctx: RequestContext = {},
  ): Promise<GoogleLoginResult> {
    this.limit(ctx);
    const identity = await this.verifier.verify(accessToken);

    const [row] = await this.db
      .select({ user: users })
      .from(userIdentities)
      .innerJoin(users, eq(users.id, userIdentities.userId))
      .where(
        and(
          eq(userIdentities.provider, PROVIDER),
          eq(userIdentities.providerSubject, identity.subject),
          isNull(users.deletedAt),
        ),
      );
    if (row) {
      if (!row.user.isActive) {
        throw new AppError(
          401,
          'UNAUTHENTICATED',
          'Tài khoản không còn hoạt động',
        );
      }
      const session = await this.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ lastLoginAt: new Date() })
          .where(eq(users.id, row.user.id));
        await this.audit(tx, row.user.id, 'auth.google_login', {
          ip: ctx.ip ?? null,
        });
        return this.auth.createSession(row.user.id, ctx, tx);
      });
      return {
        kind: 'session',
        session,
        user: await this.auth.buildUserView(row.user.id),
      };
    }

    if (!(await this.settings.allowsSignup(identity.email))) {
      throw new AppError(
        403,
        'SIGNUP_DISABLED',
        'Tài khoản Google này chưa được cấp tài khoản trong hệ thống. Vui lòng liên hệ Quản lý.',
      );
    }
    return {
      kind: 'signup_required',
      signupToken: await this.signSignupToken(identity),
      email: identity.email,
      suggestedName: identity.name,
    };
  }

  async signup(
    input: {
      signupToken: string;
      username: string;
      password: string;
      fullName: string;
      phone: string;
    },
    ctx: RequestContext = {},
  ): Promise<{ session: Session; user: AuthUserView }> {
    this.limit(ctx);
    const identity = await this.verifySignupToken(input.signupToken);
    // Công tắc có thể vừa bị tắt kể từ lúc phát token
    if (!(await this.settings.allowsSignup(identity.email))) {
      throw new AppError(
        403,
        'SIGNUP_DISABLED',
        'Hiện không cho phép tự đăng ký. Vui lòng liên hệ Quản lý.',
      );
    }

    const username = input.username.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(username)) {
      throw this.invalid(
        'username',
        'Tên đăng nhập gồm chữ thường không dấu, số, ".", "_", "-", dài 3–32 ký tự',
      );
    }
    const phone = normalizeVnPhone(input.phone);
    if (!phone) {
      throw this.invalid(
        'phone',
        'Số điện thoại không hợp lệ (10–11 chữ số, bắt đầu bằng 0 hoặc +84)',
      );
    }
    const problems = passwordProblems(input.password, {
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
    // Băm mật khẩu (chậm) ngoài transaction
    const passwordHash = await hashPassword(input.password);

    const created = await this.db
      .transaction(async (tx) => {
        const [pending] = await tx
          .select({ n: count() })
          .from(users)
          .where(
            and(
              eq(users.role, PENDING_ROLE),
              eq(users.isActive, true),
              isNull(users.deletedAt),
            ),
          );
        if ((pending?.n ?? 0) >= MAX_PENDING_ACCOUNTS) {
          throw new AppError(
            429,
            'SIGNUP_LIMIT',
            'Đang có quá nhiều tài khoản chờ cấp quyền. Vui lòng liên hệ Quản lý.',
          );
        }
        const [dup] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.username, username));
        if (dup) this.throwDuplicate(username);
        const [user] = await tx
          .insert(users)
          .values({
            code: await nextDocumentCode(tx, USER_CODE_PREFIX),
            username,
            fullName: input.fullName.trim(),
            passwordHash,
            mustChangePassword: false,
            role: PENDING_ROLE,
            phone,
            lastLoginAt: new Date(),
          })
          .returning();
        await tx.insert(userIdentities).values({
          userId: user!.id,
          provider: PROVIDER,
          providerSubject: identity.subject,
          email: identity.email,
        });
        await this.audit(tx, user!.id, 'auth.google_signup', {
          username,
          email: identity.email,
          ip: ctx.ip ?? null,
        });
        const session = await this.auth.createSession(user!.id, ctx, tx);
        return { userId: user!.id, session };
      })
      .catch((e: unknown) => {
        const violated = uniqueViolation(e);
        if (!violated) throw e;
        if (violated.constraint?.includes('user_identities')) {
          throw new AppError(
            409,
            'GOOGLE_ALREADY_REGISTERED',
            'Tài khoản Google này đã đăng ký. Hãy đăng nhập bằng Google.',
          );
        }
        if (violated.constraint?.includes('code')) {
          throw new AppError(
            409,
            'DUPLICATE_CODE',
            'Mã nhân viên được cấp đã tồn tại (bộ đếm mã bị lệch). Hãy báo quản trị hệ thống.',
          );
        }
        this.throwDuplicate(username);
      });
    return {
      session: created.session,
      user: await this.auth.buildUserView(created.userId),
    };
  }

  // ------------------------------------------------------------------ nội bộ

  private limit(ctx: RequestContext): void {
    const key = ctx.ip ?? '-';
    this.throttle.assertAllowed(key);
    this.throttle.recordFailure(key);
  }

  private async signSignupToken(identity: GoogleIdentity): Promise<string> {
    const iat = Math.floor(Date.now() / 1000);
    return new SignJWT({ email: identity.email, name: identity.name })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(identity.subject)
      .setIssuer(ISSUER)
      .setAudience(SIGNUP_AUDIENCE)
      .setIssuedAt(iat)
      .setExpirationTime(iat + SIGNUP_TTL_SECONDS)
      .sign(this.key);
  }

  private async verifySignupToken(token: string): Promise<GoogleIdentity> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: SIGNUP_AUDIENCE,
        algorithms: ['HS256'],
      });
      if (!payload.sub || typeof payload.email !== 'string') throw new Error();
      return {
        subject: payload.sub,
        email: payload.email,
        name: typeof payload.name === 'string' ? payload.name : null,
      };
    } catch {
      throw new AppError(
        401,
        'SIGNUP_TOKEN_INVALID',
        'Phiên đăng ký đã hết hạn hoặc không hợp lệ. Hãy đăng nhập Google lại.',
      );
    }
  }

  private invalid(field: string, message: string): AppError {
    return new AppError(400, 'VALIDATION_ERROR', message, [{ field, message }]);
  }

  private throwDuplicate(username: string): never {
    throw new AppError(
      409,
      'DUPLICATE_USERNAME',
      `Tên đăng nhập "${username}" đã được dùng`,
      [{ field: 'username', message: 'Tên đăng nhập đã được dùng' }],
    );
  }

  private audit(
    db: DbOrTx,
    userId: string,
    action: string,
    after: Record<string, unknown>,
  ): Promise<void> {
    return this.auditLog.record(db, {
      userId,
      action,
      entityType: 'auth',
      entityId: userId,
      after,
      ip: typeof after.ip === 'string' ? after.ip : null,
    });
  }
}
