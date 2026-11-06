import { FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  TableSearch,
  ColumnPicker,
  type ColumnOption,
} from '@/components/data-table/table-toolbar';
import type { PurchaseDocument } from '@/lib/api/types';
import { PURCHASE_STATUS } from '@/lib/purchasing';

// FilterSelect đã chuyển về components/data-table/table-toolbar; re-export để màn mua hàng cũ không vỡ.
export { FilterSelect } from '@/components/data-table/table-toolbar';
export function PurchaseStatus({ status }: { status: PurchaseDocument['status'] }) {
  const variant =
    status === 'completed'
      ? 'success'
      : status === 'cancelled'
        ? 'danger'
        : status === 'confirmed'
          ? 'info'
          : 'neutral';
  return <span className={`badge badge-${variant}`}>{PURCHASE_STATUS[status]}</span>;
}
export function PurchaseToolbar({
  search,
  setSearch,
  placeholder,
  children,
  total,
  columns,
  hidden,
  onToggle,
  onReset,
  onExport,
  exporting,
}: {
  search: string;
  setSearch: (value: string) => void;
  placeholder: string;
  children: React.ReactNode;
  total?: number;
  columns: readonly ColumnOption[];
  hidden: ReadonlySet<string>;
  onToggle: (id: string, visible: boolean) => void;
  onReset: () => void;
  onExport: () => void;
  exporting: boolean;
}) {
  return (
    <div className="toolbar purchase-toolbar">
      <TableSearch
        value={search}
        onChange={setSearch}
        placeholder={placeholder}
        label={placeholder}
      />
      {children}
      <div className="toolbar-end">
        {total !== undefined && (
          <span className="toolbar-count tabular" aria-live="polite">
            {total.toLocaleString('vi-VN')} kết quả
          </span>
        )}
        <ColumnPicker options={columns} hidden={hidden} onToggle={onToggle} onReset={onReset} />
        <Button variant="outline" disabled={exporting || !total} onClick={onExport}>
          <FileSpreadsheet aria-hidden="true" />
          {exporting ? 'Đang xuất…' : 'Xuất Excel'}
        </Button>
      </div>
    </div>
  );
}
