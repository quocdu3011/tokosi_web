import { Inject, Injectable } from '@nestjs/common';
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import { AppError } from '../../common/app-error.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';

/** Danh tính Google đã được Supabase xác minh. */
export interface GoogleIdentity {
  /** `sub` của Supabase Auth: ổn định theo tài khoản Google (khác email, email có thể đổi). */
  subject: string;
  email: string;
  name: string | null;
}

/** Cách lấy khóa công khai; production là JWKS từ xa của Supabase, test truyền JWKS cục bộ. */
export const SUPABASE_KEYS = Symbol('SUPABASE_KEYS');

/**
 * Kiểm tra access token do Supabase cấp (đăng nhập Google) bằng khóa công khai bất đối xứng (JWKS):
 * chữ ký, `iss`, `aud=authenticated`, hạn dùng. Chỉ nhận khi nhà cung cấp là Google và email đã được Google xác minh.
 * KHÔNG đọc `user_metadata` để quyết định quyền (người dùng sửa được); chỉ lấy tên để điền sẵn vào form.
 */
@Injectable()
export class SupabaseJwtVerifier {
  private readonly keys?: JWTVerifyGetKey;
  private readonly issuer?: string;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(SUPABASE_KEYS) keys?: JWTVerifyGetKey,
  ) {
    if (config.supabase) {
      this.issuer = `${config.supabase.url}/auth/v1`;
      this.keys =
        keys ??
        createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
    }
  }

  get configured(): boolean {
    return this.keys !== undefined;
  }

  async verify(token: string): Promise<GoogleIdentity> {
    if (!this.keys || !this.issuer) {
      throw new AppError(
        503,
        'GOOGLE_NOT_CONFIGURED',
        'Chưa cấu hình đăng nhập Google (SUPABASE_URL)',
      );
    }
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        issuer: this.issuer,
        audience: 'authenticated',
        algorithms: ['ES256', 'RS256'],
      }));
    } catch {
      throw this.invalid();
    }
    const email = typeof payload.email === 'string' ? payload.email : '';
    const meta = asRecord(payload.app_metadata);
    const provider = typeof meta.provider === 'string' ? meta.provider : '';
    const userMeta = asRecord(payload.user_metadata);
    // Supabase đặt email_verified trong user_metadata (lấy từ Google); chỉ tin khi đúng là true
    const verified = userMeta.email_verified === true;
    if (!payload.sub || !email || provider !== 'google' || !verified) {
      throw this.invalid();
    }
    const rawName = userMeta.full_name ?? userMeta.name;
    return {
      subject: payload.sub,
      email: email.trim().toLowerCase(),
      name:
        typeof rawName === 'string' && rawName.trim()
          ? rawName.trim().slice(0, 120)
          : null,
    };
  }

  private invalid(): AppError {
    return new AppError(
      401,
      'UNAUTHENTICATED',
      'Phiên đăng nhập Google không hợp lệ',
    );
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
