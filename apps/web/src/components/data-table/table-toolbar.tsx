'use client';

import { Search, SlidersHorizontal, Upload, X } from 'lucide-react';

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
export { ExportMenu } from './export-menu';

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

/**
 * Nút "Cột" ẩn/hiện cột của bảng (giống "Ẩn hiện cột" của KiotViet): hộp tích chọn từng cột.
 * Menu giữ mở sau mỗi lần tích để bật/tắt nhiều cột liền nhau; "Mặc định" khôi phục lựa chọn ban đầu.
 */
export function ColumnPicker({
  options,
  hidden,
  onToggle,
  onReset,
}: {
  options: readonly ColumnOption[];
  hidden: ReadonlySet<string>;
  onToggle: (id: string, visible: boolean) => void;
  onReset: () => void;
}) {
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
        <DropdownMenuItem onSelect={(e) => (e.preventDefault(), onReset())}>
          Mặc định
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
