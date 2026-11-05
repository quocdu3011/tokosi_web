import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { AuthSettings, UpdateAuthSettingsInput } from '@/lib/api/types';

/** Cài đặt tự đăng ký bằng Google (`/settings/auth`, chỉ Quản lý — quyền `user.manage`). */

const KEY = ['settings', 'auth'] as const;

export function useAuthSettings() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => api.get<AuthSettings>('/settings/auth', { signal, branchId: null }),
  });
}

export function useUpdateAuthSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateAuthSettingsInput) =>
      api.patch<AuthSettings>('/settings/auth', patch, { branchId: null }),
    onSuccess: (saved) => qc.setQueryData(KEY, saved),
  });
}
