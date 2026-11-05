'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { Field } from '@/components/common/field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { errorMessage } from '@/lib/api';
import type { BranchSummary, PriceGrid } from '@/lib/api/types';
import { useCopyBranch } from '@/lib/queries/price-books';

const ALL = 'all';

/**
 * Sao chép giá từ chi nhánh này sang chi nhánh kia (khởi tạo giá cho chi nhánh mới).
 * Mặc định chỉ chép ô đích CHƯA có giá; "ghi đè" là thao tác phá dữ liệu nên có cảnh báo riêng.
 */
export function CopyBranchDialog({
  workingBranchId,
  branches,
  books,
  pendingCount,
  onClose,
}: {
  workingBranchId: string;
  branches: BranchSummary[];
  books: PriceGrid['books'];
  pendingCount: number;
  onClose: () => void;
}) {
  const [fromId, setFromId] = useState(workingBranchId);
  const [toId, setToId] = useState(branches.find((b) => b.id !== workingBranchId)?.id ?? '');
  const [bookId, setBookId] = useState<string>(ALL);
  const [overwrite, setOverwrite] = useState(false);
  const mutation = useCopyBranch();

  const same = fromId === toId;
  const toName = branches.find((b) => b.id === toId)?.name;
  const canSubmit = toId !== '' && !same && pendingCount === 0 && !mutation.isPending;

  const submit = async () => {
    try {
      const res = await mutation.mutateAsync({
        fromBranchId: fromId,
        toBranchId: toId,
        priceBookId: bookId === ALL ? undefined : bookId,
        overwrite,
      });
      toast.success(`Đã sao chép ${res.copied} ô giá, bỏ qua ${res.skipped} ô`);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const branchSelect = (id: string, value: string, set: (v: string) => void, label: string) => (
    <Field id={id} label={label}>
      <Select value={value} onValueChange={set}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {branches.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="modal-form" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Sao chép giá sang chi nhánh khác</DialogTitle>
          <DialogDescription>
            Giá của từng chi nhánh là riêng biệt. Thao tác này chép số tiền từ chi nhánh nguồn sang
            chi nhánh đích.
          </DialogDescription>
        </DialogHeader>

        {pendingCount > 0 && (
          <p className="alert alert-error" role="alert">
            Còn {pendingCount} ô sửa chưa lưu trên lưới. Hãy lưu hoặc hủy trước khi sao chép.
          </p>
        )}

        <div className="form-grid">
          {branchSelect('copy-from', fromId, setFromId, 'Từ chi nhánh')}
          {branchSelect('copy-to', toId, setToId, 'Sang chi nhánh')}
          {same && (
            <p className="field-error span-2" role="alert">
              Hai chi nhánh phải khác nhau.
            </p>
          )}
          <Field id="copy-book" label="Bảng giá" className="span-2">
            <Select value={bookId} onValueChange={setBookId}>
              <SelectTrigger id="copy-book">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Mọi bảng giá</SelectItem>
                {books.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="check-row span-2">
            <Checkbox
              id="copy-overwrite"
              checked={overwrite}
              onCheckedChange={(c) => setOverwrite(c === true)}
            />
            <Label htmlFor="copy-overwrite">Ghi đè cả những ô chi nhánh đích đã có giá</Label>
          </div>
          {overwrite && (
            <p className="alert alert-error span-2" role="alert">
              Giá hiện có của {toName ?? 'chi nhánh đích'} sẽ bị thay bằng giá chi nhánh nguồn và
              không hoàn tác được từ màn hình này.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Đóng
          </Button>
          <Button
            variant={overwrite ? 'destructive' : 'default'}
            onClick={submit}
            disabled={!canSubmit}
          >
            {mutation.isPending ? 'Đang sao chép…' : 'Sao chép'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
