import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const ALLOW_PENDING_PASSWORD_KEY = 'allowPendingPasswordChange';

/** Endpoint không cần đăng nhập (đăng nhập, làm mới token, kiểm tra sống…). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Cho phép người dùng đang bị bắt buộc đổi mật khẩu (`must_change_password`) gọi endpoint này.
 * Mọi endpoint khác trả 403 `PASSWORD_CHANGE_REQUIRED` cho tới khi họ đổi mật khẩu.
 */
export const AllowPendingPasswordChange = () =>
  SetMetadata(ALLOW_PENDING_PASSWORD_KEY, true);
