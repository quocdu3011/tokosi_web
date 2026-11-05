import type { GoogleSignupRequired, SessionResponse } from '@/lib/api/types';

/** Phần thuần (không gọi mạng) của đăng nhập Google và cài đặt tự đăng ký. */

/** `200` có phiên, `202` cần hoàn tất đăng ký: phân biệt theo field `signupToken`. */
export function isSignupRequired(
  res: SessionResponse | GoogleSignupRequired,
): res is GoogleSignupRequired {
  return 'signupToken' in res;
}

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Tách danh sách tên miền từ ô nhập (mỗi dòng/dấu phẩy/dấu cách một tên miền): chữ thường,
 * bỏ `@` đầu, bỏ trùng. `invalid` là các mục sai dạng (vd. thiếu dấu chấm).
 */
export function parseSignupDomains(text: string): { domains: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const domains: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const d = raw.trim().replace(/^@/, '').toLowerCase();
    if (!d || seen.has(d)) continue;
    seen.add(d);
    (DOMAIN_RE.test(d) ? domains : invalid).push(d);
  }
  return { domains, invalid };
}

/** Lỗi của form cài đặt: tên miền sai dạng, hoặc bật tự đăng ký mà không có tên miền nào. */
export function domainsProblem(
  enabled: boolean,
  parsed: { domains: string[]; invalid: string[] },
): string | null {
  if (parsed.invalid.length > 0) return `Tên miền không hợp lệ: ${parsed.invalid.join(', ')}`;
  if (enabled && parsed.domains.length === 0) {
    return 'Cần ít nhất một tên miền email khi bật tự đăng ký';
  }
  return null;
}

/** Thông báo cho các lỗi đăng nhập Google mà API trả về (theo `code`). */
export function googleErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'SIGNUP_DISABLED':
      return 'Tài khoản Google này chưa có trong hệ thống và việc tự đăng ký đang tắt. Hãy liên hệ Quản lý.';
    case 'GOOGLE_NOT_CONFIGURED':
      return 'Hệ thống chưa cấu hình đăng nhập Google. Hãy dùng tên đăng nhập và mật khẩu.';
    case 'SIGNUP_TOKEN_INVALID':
      return 'Phiên đăng ký đã hết hạn. Hãy đăng nhập bằng Google lại.';
    case 'GOOGLE_ALREADY_REGISTERED':
      return 'Tài khoản Google này đã đăng ký. Hãy đăng nhập bằng Google.';
    case 'SIGNUP_LIMIT':
      return 'Đang có quá nhiều tài khoản chờ cấp quyền. Hãy liên hệ Quản lý.';
    default:
      return fallback;
  }
}
