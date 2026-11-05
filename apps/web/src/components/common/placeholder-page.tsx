'use client';

import { ComingSoon } from '@/components/common/coming-soon';
import { RequirePermission } from '@/components/common/require-permission';
import { findNavItem } from '@/lib/navigation';

/** Trang của phân hệ chưa có API: kiểm tra quyền theo menu rồi hiện trang trống. */
export function PlaceholderPage({ href }: { href: string }) {
  const item = findNavItem(href);
  if (!item) return null;
  return (
    <RequirePermission anyOf={item.permissions}>
      <ComingSoon title={item.label} />
    </RequirePermission>
  );
}
