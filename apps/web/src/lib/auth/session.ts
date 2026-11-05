import type { QueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  AuthUser,
  GoogleSignupInput,
  GoogleSignupRequired,
  SessionResponse,
} from '@/lib/api/types';
import { isSignupRequired } from '@/lib/google-auth';
import { useBranchStore } from '@/lib/branch';

import { useAuthStore } from './store';

/** Các thao tác phiên đăng nhập: đăng nhập, khôi phục phiên khi tải trang, đăng xuất, đổi mật khẩu. */

export function applySession(session: SessionResponse) {
  useAuthStore.getState().setSession(session.accessToken, session.user);
  useBranchStore.getState().syncWithUser(session.user);
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const session = await api.post<SessionResponse>(
    '/auth/login',
    { username, password },
    { auth: false, branchId: null },
  );
  applySession(session);
  return session.user;
}

/** Tải lại thông tin người dùng + quyền + chi nhánh hiện tại (gọi sau 403 hoặc khi đổi quyền). */
export async function reloadMe(): Promise<AuthUser> {
  const user = await api.get<AuthUser>('/auth/me', { branchId: null });
  useAuthStore.getState().setUser(user);
  useBranchStore.getState().syncWithUser(user);
  return user;
}

/** Khi mở/tải lại trang: lấy lại access token bằng cookie refresh rồi đọc `/auth/me`. */
export async function bootstrapSession(): Promise<void> {
  const token = await api.refreshAccessToken();
  if (!token) {
    useAuthStore.getState().clear();
    return;
  }
  try {
    await reloadMe();
  } catch {
    useAuthStore.getState().clear();
  }
}

export async function logout(queryClient?: QueryClient): Promise<void> {
  try {
    await api.post<void>('/auth/logout', undefined, { auth: false, branchId: null });
  } finally {
    // Access token cũ vẫn còn hạn tới 15 phút nên phải xóa khỏi bộ nhớ dù server lỗi.
    useAuthStore.getState().clear();
    queryClient?.clear();
  }
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const session = await api.post<SessionResponse>(
    '/auth/change-password',
    { currentPassword, newPassword },
    { branchId: null },
  );
  applySession(session);
  return session.user;
}

/**
 * Đăng nhập bằng token Supabase (`POST /auth/google`). Có tài khoản → áp dụng phiên; chưa có và được
 * phép tự đăng ký → trả `signup_required` (chưa tạo gì) để màn hình hiện form hồ sơ.
 */
export async function googleLogin(
  accessToken: string,
): Promise<SessionResponse | GoogleSignupRequired> {
  const res = await api.post<SessionResponse | GoogleSignupRequired>(
    '/auth/google',
    { accessToken },
    { auth: false, branchId: null },
  );
  if (!isSignupRequired(res)) applySession(res);
  return res;
}

/** Hoàn tất tự đăng ký từ Google; tài khoản mới có vai trò `pending` cho tới khi Quản lý cấp quyền. */
export async function googleSignup(input: GoogleSignupInput): Promise<AuthUser> {
  const session = await api.post<SessionResponse>('/auth/google/signup', input, {
    auth: false,
    branchId: null,
  });
  applySession(session);
  return session.user;
}
