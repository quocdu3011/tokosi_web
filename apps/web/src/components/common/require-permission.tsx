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
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <ShieldX className="text-muted-foreground size-10" />
      <h2 className="text-lg font-semibold">Bạn không có quyền truy cập trang này</h2>
      <p className="text-muted-foreground max-w-md text-sm">
        Liên hệ Quản lý nếu bạn cần dùng chức năng này.
      </p>
    </div>
  );
}
