import { create } from 'zustand';

import type { AuthUser } from '@/lib/api/types';

/**
 * Trạng thái đăng nhập. Access token CHỈ nằm trong bộ nhớ (không localStorage/sessionStorage)
 * theo docs/api/README.md mục 2; tải lại trang thì lấy lại bằng cookie refresh httpOnly.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  status: AuthStatus;
  accessToken: string | null;
  user: AuthUser | null;
  setAccessToken: (token: string | null) => void;
  setSession: (token: string, user: AuthUser) => void;
  setUser: (user: AuthUser) => void;
  /** Xóa mọi trạng thái đăng nhập (đăng xuất / hết phiên). */
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  accessToken: null,
  user: null,
  setAccessToken: (accessToken) => set({ accessToken }),
  setSession: (accessToken, user) => set({ accessToken, user, status: 'authenticated' }),
  setUser: (user) => set({ user, status: 'authenticated' }),
  clear: () => set({ accessToken: null, user: null, status: 'anonymous' }),
}));
