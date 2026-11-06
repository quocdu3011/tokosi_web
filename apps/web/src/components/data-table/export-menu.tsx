'use client';

import { FileSpreadsheet } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { errorMessage } from '@/lib/api';

/** Chọn cột trước khi xuất Excel; chỉ đóng khi tải file thành công. */
export function ExportMenu<TId extends string>({
  options,
  onExport,
  disabled,
}: {
  options: readonly { id: TId; label: string }[];
  onExport: (columns: TId[]) => Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<TId>>(new Set());
  const [busy, setBusy] = useState(false);
  const exporting = useRef(false);
  const chosen = options.filter((option) => selected.has(option.id));
  const selectDefaults = () => setSelected(new Set(options.map((option) => option.id)));

  const run = async () => {
    if (exporting.current || disabled || chosen.length === 0) return;
    exporting.current = true;
    setBusy(true);
    try {
      await onExport(chosen.map((option) => option.id));
      setOpen(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      exporting.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (exporting.current) return;
        if (next) selectDefaults();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled || busy || options.length === 0}>
          <FileSpreadsheet aria-hidden="true" />
          Xuất Excel
        </Button>
      </DialogTrigger>
      <DialogContent className="modal-lg export-dialog" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Xuất Excel · Hàng hóa</DialogTitle>
          <DialogDescription>
            Chọn các cột cần xuất. Dữ liệu áp dụng bộ lọc hiện tại.
          </DialogDescription>
        </DialogHeader>
        <div className="export-dialog-actions">
          <span>Cột trong file Excel</span>
          <div>
            <Button variant="outline" size="sm" disabled={busy} onClick={selectDefaults}>
              Chọn tất cả
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={selectDefaults}>
              Mặc định
            </Button>
          </div>
        </div>
        <div className="export-column-grid" role="group" aria-label="Cột xuất Excel">
          {options.map((option) => (
            <label className="export-column-option" key={option.id}>
              <Checkbox
                checked={selected.has(option.id)}
                disabled={busy}
                onCheckedChange={(checked) => {
                  setSelected((previous) => {
                    const next = new Set(previous);
                    if (checked === true) next.add(option.id);
                    else next.delete(option.id);
                    return next;
                  });
                }}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <div className="export-dialog-bottom">
          <p className="export-dialog-count" role="status">
            Đã chọn {chosen.length}/{options.length} cột
            {chosen.length === 0 && <span>Chọn ít nhất một cột để xuất.</span>}
          </p>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Hủy
            </Button>
            <Button
              disabled={disabled || busy || chosen.length === 0}
              aria-busy={busy}
              onClick={() => void run()}
            >
              {busy ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <FileSpreadsheet aria-hidden="true" />
              )}
              {busy ? 'Đang xuất…' : 'Xuất Excel'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
