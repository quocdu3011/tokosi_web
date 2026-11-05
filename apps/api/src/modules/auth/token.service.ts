import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SignJWT, errors, jwtVerify } from 'jose';
import { AppError } from '../../common/app-error.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';

const ISSUER = 'kiot-api';
const AUDIENCE = 'kiot-web';

/** Sinh refresh token ngẫu nhiên (256 bit). Chỉ gửi cho client một lần; CSDL chỉ lưu bản băm. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Băm refresh token để lưu/so khớp (SHA-256 đủ vì token đã là ngẫu nhiên 256 bit). */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Access token JWT (HS256), sống ngắn. Chỉ chứa `sub` (id người dùng): vai trò, trạng thái và quyền
 * luôn đọc lại từ CSDL ở mỗi yêu cầu nên đổi vai trò/khóa tài khoản có hiệu lực ngay.
 */
@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.key = new TextEncoder().encode(config.jwtAccessSecret);
  }

  async signAccessToken(
    userId: string,
    now: Date = new Date(),
  ): Promise<{ token: string; expiresIn: number }> {
    const iat = Math.floor(now.getTime() / 1000);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(iat)
      .setExpirationTime(iat + this.config.accessTtlSeconds)
      .sign(this.key);
    return { token, expiresIn: this.config.accessTtlSeconds };
  }

  /** Trả về id người dùng; token hết hạn → 401 `TOKEN_EXPIRED`, mọi lỗi khác → 401 `UNAUTHENTICATED`. */
  async verifyAccessToken(
    token: string,
    now: Date = new Date(),
  ): Promise<string> {
    return (await this.verifyAccessTokenClaims(token, now)).userId;
  }

  /** Như `verifyAccessToken` nhưng trả thêm thời điểm cấp token (`issuedAt`, giây UNIX) để so với lần đổi mật khẩu. */
  async verifyAccessTokenClaims(
    token: string,
    now: Date = new Date(),
  ): Promise<{ userId: string; issuedAt: number }> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
        currentDate: now,
      });
      if (typeof payload.sub !== 'string' || payload.sub === '') {
        throw new AppError(401, 'UNAUTHENTICATED', 'Token không hợp lệ');
      }
      return { userId: payload.sub, issuedAt: payload.iat ?? 0 };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof errors.JWTExpired) {
        throw new AppError(401, 'TOKEN_EXPIRED', 'Phiên đăng nhập đã hết hạn');
      }
      throw new AppError(401, 'UNAUTHENTICATED', 'Token không hợp lệ');
    }
  }
}
