import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { from, mergeMap, of, type Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AppError } from '../../common/app-error.js';
import type { AppRequest } from '../../common/auth-user.js';
import { IDEMPOTENT_KEY } from './idempotent.decorator.js';
import {
  IDEMPOTENCY_KEY_PATTERN,
  IdempotencyService,
} from './idempotency.service.js';

/**
 * Áp dụng cho handler gắn `@Idempotent()`. Thứ tự chạy của Nest: guard (đã có người dùng) → interceptor này → handler.
 * Chỉ lưu kết quả THÀNH CÔNG; handler lỗi thì nhả khóa để gửi lại được.
 *
 * Giới hạn đã biết: nếu tiến trình sập đúng lúc handler đã commit mà chưa kịp lưu kết quả, khóa kẹt ở "đang xử lý"
 * tới khi hết hạn (24 giờ) và gửi lại nhận 409 `REQUEST_IN_PROGRESS` — nghĩa là KHÔNG bao giờ tạo trùng, đổi lại
 * người dùng phải kiểm tra danh sách chứng từ thay vì tự gửi lại.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idempotency: IdempotencyService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const enabled = this.reflector.getAllAndOverride<boolean | undefined>(
      IDEMPOTENT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!enabled) return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<AppRequest>();
    const res = http.getResponse<Response>();
    const user = req.user;
    if (!user) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Bạn cần đăng nhập');
    }

    const raw = req.headers['idempotency-key'];
    const key = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!key) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Thiếu header Idempotency-Key',
        [
          {
            field: 'Idempotency-Key',
            message:
              'Bắt buộc khi tạo chứng từ (một chuỗi ngẫu nhiên duy nhất cho mỗi thao tác)',
          },
        ],
      );
    }
    if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Idempotency-Key không hợp lệ',
        [
          {
            field: 'Idempotency-Key',
            message: '8-128 ký tự gồm chữ, số và . _ : -',
          },
        ],
      );
    }

    const branchHeader = req.headers['x-branch-id'];
    const endpoint = `${req.method} ${req.originalUrl.split('?')[0]}`;
    return from(
      this.idempotency.begin({
        userId: user.id,
        key,
        endpoint,
        content: {
          query: req.query,
          body: req.body as unknown,
          branch: Array.isArray(branchHeader) ? branchHeader[0] : branchHeader,
        },
      }),
    ).pipe(
      mergeMap((state) => {
        if (state.kind === 'replay') {
          res.status(state.status);
          res.setHeader('Idempotent-Replay', 'true');
          return of(state.body);
        }
        return next.handle().pipe(
          mergeMap((body) =>
            from(
              this.idempotency
                .complete(state.id, res.statusCode, body)
                .then(() => body),
            ),
          ),
          catchError((error: unknown) =>
            from(
              this.idempotency.abort(state.id).then(() => {
                throw error;
              }),
            ),
          ),
        );
      }),
    );
  }
}
