import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/** Độ dài tối thiểu của mật khẩu do người dùng/quản trị đặt. */
export const MIN_PASSWORD_LENGTH = 10;

/** Băm mật khẩu bằng argon2id (tham số mặc định theo khuyến nghị OWASP). Không bao giờ lưu mật khẩu thô. */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

/** So khớp mật khẩu với bản băm. Bản băm hỏng/lạ thì trả `false` thay vì ném lỗi. */
export async function verifyPassword(
  passwordHash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, plain);
  } catch {
    return false;
  }
}

/** Sinh mật khẩu ngẫu nhiên mạnh (16 ký tự, ~96 bit), dùng cho tài khoản khởi tạo. */
export function generatePassword(): string {
  return randomBytes(12).toString('base64url');
}
