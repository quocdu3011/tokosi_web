'use client';

import { ROLE_LABELS, type Role } from '@kiot/shared';

import { ComingSoon, PageHeader } from '@/components/common/coming-soon';
import { useAuthStore } from '@/lib/auth/store';
import { can } from '@/lib/permissions';

/**
 * Trang đầu sau đăng nhập. Có quyền `dashboard.view` → Tổng quan (backend chưa có API nên để trống);
 * không có → lời chào, người dùng chọn chức năng từ menu.
 */
export default function HomePage() {
  const user = useAuthStore((s) => s.user);
  if (can(user, 'dashboard.view')) return <ComingSoon title="Tổng quan" />;
  return (
    <PageHeader
      title={`Xin chào, ${user?.fullName ?? ''}`}
      description={`Vai trò: ${user ? ROLE_LABELS[user.role as Role] : ''}. Chọn chức năng ở menu bên trái để bắt đầu.`}
    />
  );
}
