'use client';

import { ShieldX } from 'lucide-react';

import { useAuthStore } from '@/lib/auth/store';
import { canAny } from '@/lib/permissions';

/** Chỉ hiển thị nội dung khi người dùng có ít nhất một quyền trong `anyOf`; ngược lại báo không đủ quyền. */
export function RequirePermission({
  anyOf,
  children,
}: {
  anyOf: string[];
  children: React.ReactNode;
}) {
  const user = useAuthStore((s) => s.user);
  if (!canAny(user, anyOf)) return <Forbidden />;
  return <>{children}</>;
}

export function Forbidden() {
  return (
    <div className="empty-state">
      <ShieldX aria-hidden="true" />
      <h2>Bạn không có quyền truy cập trang này</h2>
      <p>Liên hệ Quản lý nếu bạn cần dùng chức năng này.</p>
    </div>
  );
}
