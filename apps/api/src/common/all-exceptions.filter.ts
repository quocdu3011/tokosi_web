import { randomUUID } from 'node:crypto';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

type RequestWithId = Request & { requestId?: string };

/** Chấp nhận `X-Request-Id` do bên gọi gửi nếu hợp lệ (để nối log đầu-cuối); không thì tự sinh. */
export function requestIdMiddleware(
  req: RequestWithId,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  req.requestId =
    candidate && /^[A-Za-z0-9._-]{8,64}$/.test(candidate)
      ? candidate
      : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

const NEWLINE = String.fromCharCode(10);
const PG_FIELDS = ['constraint', 'table', 'column', 'schema'] as const;

/**
 * Mô tả lỗi để ghi log MÀ KHÔNG chứa dữ liệu cá nhân. Lỗi truy vấn của Drizzle/PostgreSQL có thông báo kèm
 * nguyên câu SQL và các tham số (họ tên, SĐT, băm mật khẩu…), và `detail` của PostgreSQL có thể chứa giá trị
 * của khóa trùng ("Key (username)=(…)"). Với loại lỗi đó chỉ ghi: tên lỗi, mã PostgreSQL, tên ràng buộc/bảng/cột
 * và các dòng stack. Lỗi khác ghi đầy đủ stack như bình thường.
 */
export function describeErrorForLog(exception: unknown): string {
  if (!(exception instanceof Error)) return String(exception);
  const chain: unknown[] = [exception];
  for (let i = 0; i < 3; i++) {
    const next = (chain[chain.length - 1] as { cause?: unknown } | null)?.cause;
    if (next === undefined || next === null) break;
    chain.push(next);
  }
  const pg = chain.find(
    (e): e is Record<string, unknown> =>
      typeof e === 'object' &&
      e !== null &&
      typeof (e as { code?: unknown }).code === 'string' &&
      /^[0-9A-Z]{5}$/.test((e as { code: string }).code),
  );
  const looksLikeQuery = /^Failed query:/i.test(exception.message);
  if (!pg && !looksLikeQuery) return exception.stack ?? exception.message;

  const info = pg
    ? [`pg=${String(pg.code)}`].concat(
        PG_FIELDS.filter((f) => typeof pg[f] === 'string').map(
          (f) => `${f}=${String(pg[f])}`,
        ),
      )
    : [];
  const frames = (exception.stack ?? '')
    .split(NEWLINE)
    .filter((l) => /^\s+at /.test(l))
    .join(NEWLINE);
  return `${exception.name} [${info.join(' ')}] (nội dung truy vấn và tham số được lược bỏ khỏi log)${NEWLINE}${frames}`;
}

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
};

const MESSAGE_BY_STATUS: Record<number, string> = {
  400: 'Yêu cầu không hợp lệ',
  401: 'Chưa đăng nhập hoặc phiên không hợp lệ',
  403: 'Bạn không có quyền thực hiện thao tác này',
  404: 'Không tìm thấy',
  405: 'Phương thức không được hỗ trợ',
  409: 'Xung đột dữ liệu',
  413: 'Dữ liệu gửi lên quá lớn',
  415: 'Kiểu dữ liệu gửi lên không được hỗ trợ',
  429: 'Gọi quá nhanh, vui lòng thử lại sau',
};

export interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
}

/**
 * Mọi lỗi đều ra đúng hợp đồng `{ code, message, details?, requestId }` (docs/api/README.md mục 5):
 *  - lỗi nghiệp vụ (`AppError`) và lỗi đã có `code`: giữ nguyên, thêm `requestId`;
 *  - lỗi mặc định của Nest/Express (404, 405, JSON hỏng, quá lớn…): đổi sang `code` ổn định + thông báo tiếng Việt;
 *  - lỗi bất ngờ: 500 `INTERNAL_ERROR`, KHÔNG lộ chi tiết nội bộ cho client, ghi log đầy đủ kèm `requestId`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<RequestWithId>();
    const res = http.getResponse<Response>();
    const requestId = req.requestId ?? randomUUID();

    const { status, body } = this.toBody(exception, requestId);
    if (status >= 500) {
      this.logger.error(
        `[${requestId}] ${req.method} ${req.originalUrl ?? req.url} → ${status}`,
        describeErrorForLog(exception),
      );
    }
    if (!res.headersSent) {
      res.setHeader('X-Request-Id', requestId);
      res.status(status).json(body);
    }
  }

  private toBody(
    exception: unknown,
    requestId: string,
  ): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      if (
        raw &&
        typeof raw === 'object' &&
        typeof (raw as { code?: unknown }).code === 'string'
      ) {
        const r = raw as { code: string; message?: unknown; details?: unknown };
        return {
          status,
          body: {
            code: r.code,
            message:
              typeof r.message === 'string'
                ? r.message
                : (MESSAGE_BY_STATUS[status] ?? 'Lỗi'),
            ...(r.details === undefined ? {} : { details: r.details }),
            requestId,
          },
        };
      }
      return {
        status,
        body: {
          code: CODE_BY_STATUS[status] ?? `HTTP_${status}`,
          message:
            MESSAGE_BY_STATUS[status] ??
            (status >= 500 ? 'Lỗi hệ thống' : 'Yêu cầu không hợp lệ'),
          requestId,
        },
      };
    }

    // Lỗi của body-parser (Express) mang sẵn `status`/`statusCode` và `type`
    const e = exception as { status?: unknown; statusCode?: unknown } | null;
    const parserStatus =
      typeof e?.status === 'number'
        ? e.status
        : typeof e?.statusCode === 'number'
          ? e.statusCode
          : undefined;
    if (parserStatus && parserStatus >= 400 && parserStatus < 500) {
      return {
        status: parserStatus,
        body: {
          code: CODE_BY_STATUS[parserStatus] ?? `HTTP_${parserStatus}`,
          message:
            parserStatus === 400
              ? 'Nội dung gửi lên không phải JSON hợp lệ'
              : (MESSAGE_BY_STATUS[parserStatus] ?? 'Yêu cầu không hợp lệ'),
          requestId,
        },
      };
    }

    return {
      status: 500,
      body: {
        code: 'INTERNAL_ERROR',
        message:
          'Lỗi hệ thống. Vui lòng thử lại; nếu vẫn lỗi hãy báo kèm mã yêu cầu.',
        requestId,
      },
    };
  }
}
