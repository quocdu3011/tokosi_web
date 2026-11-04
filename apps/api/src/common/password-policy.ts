import { MIN_PASSWORD_LENGTH } from './password.js';

export const MAX_PASSWORD_LENGTH = 128;

export interface FieldProblem {
  field: string;
  message: string;
}

/**
 * Chính sách mật khẩu mới, dùng chung cho đổi mật khẩu (tự người dùng) và quản trị đặt/đặt lại.
 * 10–128 ký tự, khác mật khẩu hiện tại (nếu có), không chứa tên đăng nhập.
 */
export function passwordProblems(
  next: string,
  opts: { username: string; current?: string; field?: string },
): FieldProblem[] {
  const field = opts.field ?? 'newPassword';
  const problems: FieldProblem[] = [];
  if (next.length < MIN_PASSWORD_LENGTH) {
    problems.push({
      field,
      message: `Mật khẩu mới phải dài ít nhất ${MIN_PASSWORD_LENGTH} ký tự`,
    });
  } else if (next.length > MAX_PASSWORD_LENGTH) {
    problems.push({
      field,
      message: `Mật khẩu mới không được dài quá ${MAX_PASSWORD_LENGTH} ký tự`,
    });
  }
  if (opts.current !== undefined && next === opts.current) {
    problems.push({
      field,
      message: 'Mật khẩu mới phải khác mật khẩu hiện tại',
    });
  }
  if (next.toLowerCase().includes(opts.username.toLowerCase())) {
    problems.push({
      field,
      message: 'Mật khẩu mới không được chứa tên đăng nhập',
    });
  }
  return problems;
}
