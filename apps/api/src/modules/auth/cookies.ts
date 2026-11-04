/** Tên cookie chứa refresh token. */
export const REFRESH_COOKIE = 'refresh_token';

/** Đường dẫn cookie chỉ được gửi lên các endpoint /auth (không gửi kèm mọi yêu cầu API). */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/** Đọc cookie từ header `Cookie` (không cần thêm thư viện). Trả về chuỗi rỗng nếu không có. */
export function readCookie(header: string | undefined, name: string): string {
  if (!header) return '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return '';
      }
    }
  }
  return '';
}
