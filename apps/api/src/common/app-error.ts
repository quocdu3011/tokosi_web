import { HttpException } from '@nestjs/common';

/**
 * Lỗi nghiệp vụ theo hợp đồng API (docs/api/README.md mục 5): `{ code, message, details? }`.
 * `requestId` sẽ được bộ lọc lỗi toàn cục bổ sung khi có.
 */
export class AppError extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    details?: unknown,
  ) {
    super(
      { code, message, ...(details === undefined ? {} : { details }) },
      status,
    );
  }
}
