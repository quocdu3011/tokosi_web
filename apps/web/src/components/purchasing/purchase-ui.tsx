import { FileSpreadsheet } from 'lucide-react';
import { StatusBadge, statusTone, type StatusTone } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import type { PurchaseDocument } from '@/lib/api/types';
import { PURCHASE_STATUS, RECEIVE_STATUS } from '@/lib/purchasing';

/** Sắc thái tình trạng nhập của phiếu đặt hàng: chưa nhập → một phần → đủ. */
const RECEIVE_STATUS_TONES: Record<keyof typeof RECEIVE_STATUS, StatusTone> = {
  none: 'neutral',
  partial: 'warning',
  full: 'success',
};

/** Trạng thái chứng từ mua hàng (phiếu tạm / đã xác nhận / hoàn thành / hủy). */
export function PurchaseStatus({ status }: { status: PurchaseDocument['status'] }) {
  return <StatusBadge tone={statusTone(status)}>{PURCHASE_STATUS[status]}</StatusBadge>;
}

/** Tình trạng nhập hàng của phiếu đặt hàng. */
export function ReceiveStatus({ state }: { state: keyof typeof RECEIVE_STATUS }) {
  return (
    <StatusBadge tone={RECEIVE_STATUS_TONES[state] ?? 'neutral'}>
      {RECEIVE_STATUS[state]}
    </StatusBadge>
  );
}

/**
 * Nút "Xuất Excel" tải thẳng file theo bộ lọc hiện tại (không chọn cột). Dùng thay `ExportMenu`
 * vì hộp thoại đó hiện cố định tiêu đề "Hàng hóa".
 */
export function ExportExcelButton({
  exporting,
  disabled,
  onExport,
}: {
  exporting: boolean;
  disabled?: boolean;
  onExport: () => void;
}) {
  return (
    <Button variant="outline" disabled={exporting || disabled} onClick={onExport}>
      <FileSpreadsheet aria-hidden="true" />
      {exporting ? 'Đang xuất…' : 'Xuất Excel'}
    </Button>
  );
}
