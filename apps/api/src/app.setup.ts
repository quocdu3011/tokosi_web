import { ValidationPipe, type INestApplication } from '@nestjs/common';
import {
  AllExceptionsFilter,
  requestIdMiddleware,
} from './common/all-exceptions.filter.js';
import { validationExceptionFactory } from './common/validation.js';
import { setupOpenApi } from './openapi.js';

/** Tiền tố mọi endpoint (khớp docs/api/README.md: `/api/v1`). */
export const API_PREFIX = 'api/v1';

/**
 * Cấu hình dùng chung cho ứng dụng thật (main.ts) và test e2e,
 * để hai nơi luôn hành xử giống nhau.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);

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
