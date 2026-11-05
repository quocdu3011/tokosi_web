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

/** Tên đăng nhập: chữ thường không dấu, số, `.` `_` `-`, 3-32 ký tự (server đưa chữ hoa về chữ thường). */
export function usernameProblem(username: string): string | null {
  return /^[a-z0-9._-]{3,32}$/.test(username.trim().toLowerCase())
    ? null
    : 'Chỉ dùng chữ không dấu, số, dấu . _ -; dài 3–32 ký tự';
}

/** Chuẩn hóa như server: +84 thành 0, bỏ ký tự phân cách; còn lại chỉ giữ chữ số. */
export function normalizePhoneDigits(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  return digits.startsWith('+84') ? `0${digits.slice(3)}` : digits;
}

/** SĐT: 10–11 chữ số bắt đầu 0 hoặc +84 (cho phép khoảng trắng . - và ngoặc). Rỗng = hợp lệ (tùy chọn). */
export function phoneProblem(phone: string): string | null {
  const v = phone.trim();
  if (v === '') return null;
  const shapeOk = /^(\+84|0)[\d\s.\-()]{8,14}$/.test(v);
  return shapeOk && /^\d{10,11}$/.test(normalizePhoneDigits(v))
    ? null
    : 'Số điện thoại không hợp lệ';
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
