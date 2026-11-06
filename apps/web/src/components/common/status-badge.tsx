import * as React from 'react';

import { Badge, type BadgeVariant } from '@/components/ui/badge';

/**
 * Sắc thái của huy hiệu trạng thái — đặt tên theo NGHĨA (khớp `.badge-success|warning|danger|info|neutral`
 * trong styles/components/badge.css), không theo tên biến thể của `ui/badge`:
 * - `success`: hoàn tất/đang hoạt động · `warning`: cần chú ý/chờ xử lý · `danger`: hủy/lỗi/ngừng
 * - `info`: đã xác nhận/đang xử lý · `neutral`: nháp/không xác định
 */
export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_VARIANT: Record<StatusTone, BadgeVariant> = {
  success: 'success',
  warning: 'warning',
  danger: 'destructive',
  info: 'info',
  neutral: 'secondary',
};

/** Huy hiệu trạng thái: `<StatusBadge tone="success">Hoàn thành</StatusBadge>`. */
export function StatusBadge({
  tone = 'neutral',
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Badge>, 'variant'> & { tone?: StatusTone }) {
  return (
    <Badge variant={TONE_VARIANT[tone]} className={className} {...props}>
      {children}
    </Badge>
  );
}

/** Sắc thái dùng chung cho trạng thái CHỨNG TỪ (phiếu đặt/nhập/trả…): nháp → xác nhận → hoàn thành / hủy. */
export const DOCUMENT_STATUS_TONES: Readonly<Record<string, StatusTone>> = {
  draft: 'neutral',
  confirmed: 'info',
  completed: 'success',
  cancelled: 'danger',
};

/** Sắc thái dùng chung cho trạng thái HOẠT ĐỘNG của danh mục (hàng hóa, nhà cung cấp, tài khoản…). */
export const ACTIVE_STATUS_TONES: Readonly<Record<'active' | 'inactive', StatusTone>> = {
  active: 'success',
  inactive: 'danger',
};

/** Tra sắc thái theo mã trạng thái; mã lạ → `neutral`. */
export function statusTone(
  status: string,
  table: Readonly<Record<string, StatusTone>> = DOCUMENT_STATUS_TONES,
): StatusTone {
  return table[status] ?? 'neutral';
}
