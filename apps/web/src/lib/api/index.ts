import { useAuthStore } from '@/lib/auth/store';
import { useBranchStore } from '@/lib/branch';

import { createApiClient } from './client';

/** Địa chỉ API; cấu hình bằng biến `NEXT_PUBLIC_API_URL` (xem apps/web/.env.example). */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

/** Client dùng chung cho toàn ứng dụng, nối với store đăng nhập và chi nhánh. */
export const api = createApiClient({
  baseUrl: API_BASE_URL,
  getAccessToken: () => useAuthStore.getState().accessToken,
  setAccessToken: (token) => useAuthStore.getState().setAccessToken(token),
  getBranchId: () => useBranchStore.getState().branchId,
  onSessionExpired: () => useAuthStore.getState().clear(),
});

export { ApiError, errorMessage, isApiError } from './errors';
