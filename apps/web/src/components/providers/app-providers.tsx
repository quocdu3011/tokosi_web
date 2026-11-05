'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useEffect, useState } from 'react';

import { Toaster } from '@/components/ui/sonner';
import { isApiError } from '@/lib/api';
import { bootstrapSession, reloadMe } from '@/lib/auth/session';
import { useBranchStore } from '@/lib/branch';

/**
 * Lỗi 403 FORBIDDEN: quyền có thể vừa bị Quản lý đổi → tải lại /auth/me để cập nhật menu/nút.
 * Lỗi 403 PASSWORD_CHANGE_REQUIRED: tải lại /auth/me, cổng đăng nhập sẽ chuyển sang trang đổi mật khẩu.
 */
function onGlobalError(error: unknown) {
  if (isApiError(error, 'FORBIDDEN') || isApiError(error, 'PASSWORD_CHANGE_REQUIRED')) {
    void reloadMe().catch(() => undefined);
  }
}

function makeQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({ onError: onGlobalError }),
    mutationCache: new MutationCache({ onError: onGlobalError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Không thử lại với lỗi nghiệp vụ (4xx); chỉ thử lại lỗi mạng/5xx một lần.
        retry: (count, error) =>
          count < 1 && !(isApiError(error) && error.status >= 400 && error.status < 500),
      },
    },
  });
}

/** Đổi chi nhánh làm việc → xóa dữ liệu đã tải để mọi màn hình tải lại theo chi nhánh mới. */
function BranchCacheReset({ client }: { client: QueryClient }) {
  useEffect(() => {
    let previous = useBranchStore.getState().branchId;
    return useBranchStore.subscribe((state) => {
      if (previous !== null && state.branchId !== previous) void client.resetQueries();
      previous = state.branchId;
    });
  }, [client]);
  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient);

  // Khôi phục phiên bằng cookie refresh khi mở/tải lại trang (token chỉ nằm trong bộ nhớ).
  useEffect(() => {
    void bootstrapSession();
  }, []);

  return (
    // Dark Obsidian mặc định, chuyển Light bằng nút; lưu lựa chọn trong localStorage
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="dark"
      enableSystem={false}
      themes={['dark', 'light']}
      disableTransitionOnChange
    >
      <QueryClientProvider client={client}>
        <BranchCacheReset client={client} />
        {children}
        <Toaster position="top-right" />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
