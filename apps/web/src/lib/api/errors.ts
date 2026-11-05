/** Một lỗi gắn vào từng ô nhập liệu (`VALIDATION_ERROR`). */
export interface FieldError {
  field: string;
  message: string;
}

/**
 * Lỗi API theo hợp đồng `{ code, message, details, requestId }` (docs/api/README.md mục 5).
 * Frontend xử lý theo `code` (chuỗi ổn định); `message` là tiếng Việt, hiển thị được cho người dùng.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | null;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    requestId?: string | null;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? null;
    this.requestId = init.requestId ?? null;
  }

  /** Danh sách lỗi theo từng ô, chỉ có khi `code = VALIDATION_ERROR`. */
  get fieldErrors(): FieldError[] {
    if (!Array.isArray(this.details)) return [];
    return this.details.filter(
      (d): d is FieldError =>
        typeof d === 'object' &&
        d !== null &&
        typeof (d as FieldError).field === 'string' &&
        typeof (d as FieldError).message === 'string',
    );
  }
}

/** Lỗi mạng / server không trả JSON đúng hợp đồng. */
export const NETWORK_ERROR = 'NETWORK_ERROR';

export function isApiError(e: unknown, code?: string): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code);
}

/** Câu thông báo ngắn để hiện toast; kèm mã yêu cầu cho lỗi hệ thống để báo backend. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status >= 500 && e.requestId) return `${e.message} (mã yêu cầu: ${e.requestId})`;
    return e.message;
  }
  return 'Đã có lỗi xảy ra. Vui lòng thử lại.';
}
