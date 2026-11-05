'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { FullPageLoader } from '@/components/common/full-page-loader';
import { useAuthStore } from '@/lib/auth/store';

/**
 * Cổng đăng nhập cho khu vực quản trị:
 * - Chưa đăng nhập → về /login?next=<trang hiện tại>.
 * - Bị bắt đổi mật khẩu (`mustChangePassword`) → sang /change-password.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const mustChange = useAuthStore((s) => s.user?.mustChangePassword ?? false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    } else if (status === 'authenticated' && mustChange) {
      router.replace('/change-password');
    }
  }, [status, mustChange, router, pathname]);

  if (status !== 'authenticated' || mustChange) return <FullPageLoader />;
  return <>{children}</>;
}
