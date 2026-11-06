'use client';

import { Search, SlidersHorizontal, Upload, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { TablePrefsController } from '@/hooks/use-table-prefs';
import { cn } from '@/lib/utils';
export { ExportMenu } from './export-menu';

/** Vỏ thanh công cụ phía trên bảng (ô tìm, bộ lọc, nhóm nút bên phải `ToolbarEnd`). */
export function TableToolbar({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('toolbar', className)}>{children}</div>;
}

/** Nhóm bên phải thanh công cụ: số kết quả, nút "Cột", nhập/xuất file… (đẩy sát mép phải). */
export function ToolbarEnd({ children }: { children: ReactNode }) {
  return <div className="toolbar-end">{children}</div>;
}

/** "N kết quả" cạnh các nút bên phải thanh công cụ. */
export function ToolbarCount({ total }: { total: number }) {
  return (
    <span className="toolbar-count tabular" aria-live="polite">
      {total.toLocaleString('vi-VN')} kết quả
    </span>
  );
}

/**
 * Ô lọc dạng chọn một trong danh sách. Giá trị rỗng (`''`) nghĩa là "tất cả" (không lọc):
 * thêm một lựa chọn `{ value: '', label: 'Mọi trạng thái' }` làm mục đầu.
 */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  id,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  id?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      disabled={disabled}
      value={value || 'all'}
      onValueChange={(next) => onChange(next === 'all' ? '' : next)}
    >
      <SelectTrigger id={id} aria-label={label} className="toolbar-select">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value || 'all'} value={o.value || 'all'}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Ô tìm kiếm trên bảng: biểu tượng kính lúp, nút × xóa nhanh, Esc để xóa. */
export function TableSearch({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="toolbar-search">
      <Search aria-hidden="true" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            onChange('');
          }
        }}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
      />
      {value && (
        <button
          type="button"
          className="toolbar-search-clear"
          aria-label="Xóa tìm kiếm"
          title="Xóa tìm kiếm"
          onClick={() => onChange('')}
        >
          <X aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** Nút "Nhập Excel": chỉ hiện cho người có quyền `import.run`; bấm để mở hộp thoại nhập. */
export function ImportButton({
  onClick,
  disabled,
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <Button variant="outline" onClick={onClick} disabled={disabled} title={title}>
      <Upload aria-hidden="true" />
      Nhập Excel
    </Button>
  );
}

export interface ColumnOption {
  id: string;
  label: string;
}

interface ColumnPickerManualProps {
  options: readonly ColumnOption[];
  hidden: ReadonlySet<string>;
  onToggle: (id: string, visible: boolean) => void;
  onReset: () => void;
  prefs?: undefined;
}

interface ColumnPickerPrefsProps {
  /** Bộ điều khiển từ `useTablePrefs`: tự lấy danh sách cột, trạng thái ẩn và nút "Mặc định". */
  prefs: TablePrefsController;
  options?: undefined;
  hidden?: undefined;
  onToggle?: undefined;
  onReset?: undefined;
}

/**
 * Nút "Cột" ẩn/hiện cột của bảng (giống "Ẩn hiện cột" của KiotViet): hộp tích chọn từng cột.
 * Menu giữ mở sau mỗi lần tích để bật/tắt nhiều cột liền nhau. "Mặc định" đặt lại TOÀN BỘ tùy chỉnh bảng:
 * cột ẩn/hiện, thứ tự cột, độ rộng cột và số dòng mỗi trang.
 *
 * Dùng `<ColumnPicker prefs={prefs} />` với `useTablePrefs`; hoặc cách cũ truyền `options/hidden/onToggle/onReset`.
 */
export function ColumnPicker(props: ColumnPickerManualProps | ColumnPickerPrefsProps) {
  const { prefs } = props;
  const options = prefs ? prefs.columnOptions : props.options;
  const hidden = prefs ? prefs.hidden : props.hidden;
  const onToggle = prefs
    ? (id: string, visible: boolean) => prefs.setHidden(id, !visible)
    : props.onToggle;
  const onReset = prefs ? prefs.reset : props.onReset;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" aria-label="Ẩn hiện cột" title="Ẩn hiện cột">
          <SlidersHorizontal aria-hidden="true" />
          Cột
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="column-picker">
        <DropdownMenuLabel>Hiển thị cột</DropdownMenuLabel>
        <div className="column-picker-grid">
          {options.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.id}
              checked={!hidden.has(o.id)}
              onCheckedChange={(v) => onToggle(o.id, v === true)}
              onSelect={(e) => e.preventDefault()}
            >
              {o.label}
            </DropdownMenuCheckboxItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          title="Đặt lại cột ẩn/hiện, thứ tự cột, độ rộng cột và số dòng mỗi trang về mặc định"
          onSelect={(e) => (e.preventDefault(), onReset())}
        >
          Mặc định
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
