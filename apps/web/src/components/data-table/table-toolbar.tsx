'use client';

import { Download, FileSpreadsheet, FileText, Search, Upload, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';

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

export type ExportFormat = 'xlsx' | 'html';

/** Nút "Xuất file" mở menu Excel / HTML; chống bấm trùng khi đang xuất và báo lỗi bằng toast. */
export function ExportMenu({
  onExport,
  disabled,
}: {
  onExport: (format: ExportFormat) => Promise<void>;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  const run = async (format: ExportFormat) => {
    if (busy) return;
    setBusy(true);
    try {
      await onExport(format);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={disabled || busy} aria-busy={busy}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <Download aria-hidden="true" />}
          {busy ? 'Đang xuất…' : 'Xuất file'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void run('xlsx')}>
          <FileSpreadsheet aria-hidden="true" />
          Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void run('html')}>
          <FileText aria-hidden="true" />
          Trang HTML (.html)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
