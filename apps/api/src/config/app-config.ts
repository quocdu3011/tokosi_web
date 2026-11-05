import { Global, Module } from '@nestjs/common';

/** Token inject cấu hình ứng dụng. */
export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  /** Khóa ký access token (HS256), tối thiểu 32 ký tự. */
  jwtAccessSecret: string;
  /** Thời gian sống của access token (giây). */
  accessTtlSeconds: number;
  /** Thời gian sống của refresh token (ngày). */
  refreshTtlDays: number;
  /** Cookie refresh token có cờ Secure (bật ở production, cần HTTPS). */
  cookieSecure: boolean;
  /** Số lần đăng nhập sai tối đa trong cửa sổ thời gian trước khi bị chặn tạm. */
  loginMaxFailures: number;
  loginWindowSeconds: number;
  /** Kho lưu file (ảnh hàng hóa) chuẩn S3, ví dụ MinIO. `null` = chưa cấu hình (chỉ cho phép khi dev/test). */
  storage: StorageConfig | null;
}

export interface StorageConfig {
  /** Địa chỉ S3 API, vd http://localhost:9000 */
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  /** Địa chỉ công khai tới bucket để ghép URL ảnh: `<publicBaseUrl>/<khóa đối tượng>`. */
  publicBaseUrl: string;
}

export const MIN_JWT_SECRET_LENGTH = 32;

function positiveInt(
  name: string,
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(
      `Biến môi trường ${name} phải là số nguyên dương (đang là "${raw}")`,
    );
  }
  return n;
}

/**
 * Đọc và kiểm tra cấu hình từ biến môi trường. Thiếu hoặc sai thì **ném lỗi ngay khi khởi động**
 * (không chạy với khóa yếu/mặc định).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const secret = env.JWT_ACCESS_SECRET ?? '';
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `Thiếu hoặc quá ngắn biến môi trường JWT_ACCESS_SECRET (cần ≥ ${MIN_JWT_SECRET_LENGTH} ký tự). ` +
        "Sinh khóa ngẫu nhiên: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
    );
  }
  const cookieSecureEnv = env.COOKIE_SECURE;
  const storage = loadStorageConfig(env);
  return {
    jwtAccessSecret: secret,
    accessTtlSeconds: positiveInt(
      'ACCESS_TOKEN_TTL_SECONDS',
      env.ACCESS_TOKEN_TTL_SECONDS,
      900,
    ),
    refreshTtlDays: positiveInt(
      'REFRESH_TOKEN_TTL_DAYS',
      env.REFRESH_TOKEN_TTL_DAYS,
      14,
    ),
    cookieSecure:
      cookieSecureEnv === undefined || cookieSecureEnv === ''
        ? env.NODE_ENV === 'production'
        : cookieSecureEnv === 'true',
    loginMaxFailures: positiveInt(
      'LOGIN_MAX_FAILURES',
      env.LOGIN_MAX_FAILURES,
      5,
    ),
    loginWindowSeconds: positiveInt(
      'LOGIN_WINDOW_SECONDS',
      env.LOGIN_WINDOW_SECONDS,
      900,
    ),
    storage,
  };
}

const STORAGE_VARS = [
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'FILE_PUBLIC_BASE_URL',
] as const;

/**
 * Cấu hình kho file. Không đặt biến nào → `null` (dev/test chạy được, chỉ tải ảnh lên sẽ báo lỗi 503);
 * đặt một phần → ném lỗi ngay; production bắt buộc đặt đủ.
 */
function loadStorageConfig(env: NodeJS.ProcessEnv): StorageConfig | null {
  const present = STORAGE_VARS.filter((v) => (env[v] ?? '') !== '');
  if (present.length === 0) {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        `Production bắt buộc cấu hình kho file: ${STORAGE_VARS.join(', ')}`,
      );
    }
    return null;
  }
  const missing = STORAGE_VARS.filter((v) => !present.includes(v));
  if (missing.length > 0) {
    throw new Error(
      `Cấu hình kho file thiếu biến môi trường: ${missing.join(', ')}`,
    );
  }
  return {
    endpoint: env.S3_ENDPOINT as string,
    region: env.S3_REGION || 'us-east-1',
    bucket: env.S3_BUCKET as string,
    accessKey: env.S3_ACCESS_KEY as string,
    secretKey: env.S3_SECRET_KEY as string,
    publicBaseUrl: (env.FILE_PUBLIC_BASE_URL as string).replace(/\/+$/, ''),
  };
}

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig() },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
