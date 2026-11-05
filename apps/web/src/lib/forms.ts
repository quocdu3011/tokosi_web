import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { toast } from 'sonner';

import { ApiError, errorMessage } from '@/lib/api';

/**
 * Gắn lỗi `VALIDATION_ERROR` của server vào từng ô của biểu mẫu (field theo đường dẫn JSON).
 * Lỗi không gắn được vào ô nào → hiện toast. Trả `true` nếu đã gắn được ít nhất một lỗi.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  knownFields: readonly string[],
): boolean {
  if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
    let applied = false;
    for (const fe of error.fieldErrors) {
      if (knownFields.includes(fe.field)) {
        setError(fe.field as Path<T>, { type: 'server', message: fe.message });
        applied = true;
      }
    }
    if (applied) return true;
  }
  toast.error(errorMessage(error));
  return false;
}

/** Chính sách mật khẩu của backend (docs/api/endpoints.md mục 1): 10–128 ký tự, không chứa tên đăng nhập. */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export function passwordProblem(password: string, username?: string | null): string | null {
  if (password.length < PASSWORD_MIN) return `Mật khẩu cần ít nhất ${PASSWORD_MIN} ký tự`;
  if (password.length > PASSWORD_MAX) return `Mật khẩu tối đa ${PASSWORD_MAX} ký tự`;
  if (username && password.toLowerCase().includes(username.toLowerCase())) {
    return 'Mật khẩu không được chứa tên đăng nhập';
  }
  return null;
}
