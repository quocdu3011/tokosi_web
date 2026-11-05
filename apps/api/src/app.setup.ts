import { ValidationPipe, type INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import {
  AllExceptionsFilter,
  requestIdMiddleware,
} from './common/all-exceptions.filter.js';
import { validationExceptionFactory } from './common/validation.js';
import { setupOpenApi } from './openapi.js';

/** Tiền tố mọi endpoint (khớp docs/api/README.md: `/api/v1`). */
export const API_PREFIX = 'api/v1';

/**
 * `TRUST_PROXY`: cách Express xác định IP thật của người dùng khi API chạy SAU reverse proxy (nginx, Caddy).
 * Bỏ trống/`false` = không tin header `X-Forwarded-For` (đúng khi API tiếp nhận trực tiếp). Sau MỘT proxy: `1`.
 * Nếu không đặt đúng, mọi yêu cầu mang IP của proxy (giới hạn đăng nhập sai gộp mọi người làm một, nhật ký mất IP thật);
 * đặt quá rộng thì kẻ tấn công giả được IP bằng header.
 */
export function parseTrustProxy(
  raw: string | undefined,
): boolean | number | string {
  const v = (raw ?? '').trim();
  if (v === '' || v === 'false') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v; // danh sách mạng/từ khóa của Express, vd "loopback" hoặc "10.0.0.0/8"
}

export interface ConfigureAppOptions {
  trustProxy?: boolean | number | string;
}

/**
 * Cấu hình dùng chung cho ứng dụng thật (main.ts) và test e2e,
 * để hai nơi luôn hành xử giống nhau.
 */
export function configureApp(
  app: INestApplication,
  options: ConfigureAppOptions = {},
): void {
  app.setGlobalPrefix(API_PREFIX);

  (
    app.getHttpAdapter().getInstance() as {
      set: (k: string, v: unknown) => void;
    }
  ).set(
    'trust proxy',
    options.trustProxy ?? parseTrustProxy(process.env.TRUST_PROXY),
  );
  // Header bảo mật (nosniff, chống nhúng khung, HSTS…). Tắt CSP vì API chỉ trả JSON/file và Swagger UI cần script nội tuyến.
  app.use(helmet({ contentSecurityPolicy: false }));

  // Cho phép web gọi kèm cookie (refresh token). Origin lấy từ biến môi trường.
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(','),
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  });

  // Gắn `requestId` cho mọi yêu cầu (kể cả 404) và đưa mọi lỗi về đúng hợp đồng `{ code, message, details, requestId }`.
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new AllExceptionsFilter());

  // Kiểm tra dữ liệu vào theo DTO: bỏ field lạ, từ chối field không khai báo, tự ép kiểu.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  setupOpenApi(app);
}
