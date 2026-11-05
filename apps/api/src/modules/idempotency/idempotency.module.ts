import { Module, type OnApplicationBootstrap } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { IdempotencyService } from './idempotency.service.js';

/**
 * Chống tạo trùng chứng từ: interceptor toàn cục chỉ tác động tới handler gắn `@Idempotent()`.
 * Khi khởi động dọn các khóa đã hết hạn (chưa có bộ lập lịch).
 */
@Module({
  providers: [
    IdempotencyService,
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [IdempotencyService],
})
export class IdempotencyModule implements OnApplicationBootstrap {
  constructor(private readonly idempotency: IdempotencyService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.idempotency.purgeExpired().catch(() => undefined);
  }
}
