'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { Field } from '@/components/common/field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { errorMessage } from '@/lib/api';
import type { BulkAdjustInput, BulkAdjustResult, PriceGrid } from '@/lib/api/types';
import { formatMoney } from '@/lib/format';
import { useBulkAdjust } from '@/lib/queries/price-books';

const ALL = 'all';

/** Số có dấu: "5", "-3.5", "+2". Không cho dạng khác để khỏi gửi lên rồi mới bị từ chối. */
const SIGNED_NUMBER = /^[+-]?\d+(\.\d+)?$/;
const POSITIVE_INT = /^[1-9]\d*$/;

type Mode = BulkAdjustInput['mode'];

/**
 * Tăng/giảm giá hàng loạt MỘT bảng giá của chi nhánh đang làm việc.
 * Luôn xem trước (`dryRun: true`) rồi mới áp dụng thật (`dryRun: false`) — đổi bất kỳ ô nhập nào
 * thì kết quả xem trước bị bỏ, phải xem trước lại.
 */
export function BulkAdjustDialog({
  branchId,
  branchName,
  books,
  categories,
  pendingCount,
  onClose,
}: {
  branchId: string;
  branchName: string | undefined;
  books: PriceGrid['books'];
  categories: { id: string; name: string; depth: number }[];
  /** Số ô đang sửa dở trên lưới: phải lưu/hủy trước để khỏi ghi chồng. */
  pendingCount: number;
  onClose: () => void;
}) {
  const [bookId, setBookId] = useState<string>(books[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState<string>(ALL);
  const [mode, setMode] = useState<Mode>('percent');
  const [value, setValue] = useState('');
  const [roundTo, setRoundTo] = useState('1');
  const [preview, setPreview] = useState<BulkAdjustResult | null>(null);
  const mutation = useBulkAdjust();

  const valueOk = SIGNED_NUMBER.test(value.trim());
  const roundOk = POSITIVE_INT.test(roundTo.trim());
  const canSubmit = bookId !== '' && valueOk && roundOk && !mutation.isPending;

  /** Đổi ô nhập nào cũng làm kết quả xem trước cũ hết giá trị. */
  const edit =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPreview(null);
    };

  const buildInput = (dryRun: boolean): BulkAdjustInput => ({
    branchId,
    priceBookId: bookId,
    categoryId: categoryId === ALL ? undefined : categoryId,
    mode,
    // Bỏ dấu "+" ở đầu cho khớp dạng số của server.
    value: value.trim().replace(/^\+/, ''),
    roundTo: roundTo.trim(),
    dryRun,
  });

  const run = async (dryRun: boolean) => {
    try {
      const res = await mutation.mutateAsync(buildInput(dryRun));
      if (dryRun) {
        setPreview(res);
      } else {
        toast.success(`Đã điều chỉnh giá ${res.affected} ô`);
        onClose();
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const bookName = books.find((b) => b.id === bookId)?.name;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="modal-form" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Tăng/giảm giá hàng loạt</DialogTitle>
          <DialogDescription>
            Áp dụng cho chi nhánh <b>{branchName ?? '—'}</b>. Chỉ đổi các ô <b>đã có giá</b>; giá
            mới luôn làm tròn ra số nguyên đồng, ô ra giá âm sẽ bị bỏ qua.
          </DialogDescription>
        </DialogHeader>

        {pendingCount > 0 && (
          <p className="alert alert-error" role="alert">
            Còn {pendingCount} ô sửa chưa lưu trên lưới. Hãy lưu hoặc hủy trước khi điều chỉnh hàng
            loạt.
          </p>
        )}

        <div className="form-grid">
          <Field id="bulk-book" label="Bảng giá">
            <Select value={bookId} onValueChange={edit(setBookId)}>
              <SelectTrigger id="bulk-book">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {books.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="bulk-category" label="Nhóm hàng">
            <Select value={categoryId} onValueChange={edit(setCategoryId)}>
              <SelectTrigger id="bulk-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Mọi nhóm hàng</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {'  '.repeat(c.depth)}
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="bulk-mode" label="Cách điều chỉnh">
            <Select value={mode} onValueChange={edit((v: string) => setMode(v as Mode))}>
              <SelectTrigger id="bulk-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">Theo phần trăm (%)</SelectItem>
                <SelectItem value="amount">Cộng/trừ số tiền cố định (₫)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field
            id="bulk-value"
            label={mode === 'percent' ? 'Giá trị (%)' : 'Số tiền (₫)'}
            hint="Số dương = tăng, số âm = giảm. Ví dụ 5 là tăng 5%, -3.5 là giảm 3,5%."
            error={value !== '' && !valueOk ? 'Nhập số, ví dụ 5 hoặc -3.5' : undefined}
          >
            <Input
              id="bulk-value"
              inputMode="decimal"
              autoComplete="off"
              value={value}
              aria-invalid={value !== '' && !valueOk ? true : undefined}
              onChange={(e) => edit(setValue)(e.target.value)}
            />
          </Field>
          <Field
            id="bulk-round"
            label="Làm tròn đến bội số của"
            hint="Ví dụ 100: 35.175 thành 35.200. Nhập 1 để chỉ làm tròn đến đồng."
            error={!roundOk ? 'Phải là số nguyên từ 1 trở lên' : undefined}
            className="span-2"
          >
            <Input
              id="bulk-round"
              inputMode="numeric"
              autoComplete="off"
              value={roundTo}
              aria-invalid={!roundOk ? true : undefined}
              onChange={(e) => edit(setRoundTo)(e.target.value)}
            />
          </Field>
        </div>

        {preview && (
          <div className="bulk-preview" aria-live="polite">
            <p>
              Bảng giá <b>{bookName}</b>: <b>{preview.affected}</b> ô sẽ đổi giá
              {preview.unchanged > 0 && <>, {preview.unchanged} ô giữ nguyên sau khi làm tròn</>}
              {preview.skipped > 0 && <>, {preview.skipped} ô bỏ qua vì giá mới âm</>}.
            </p>
            {preview.preview.length > 0 && (
              <div className="data-table-frame">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Mã hàng</th>
                      <th>
                        <span className="num">Giá cũ</span>
                      </th>
                      <th>
                        <span className="num">Giá mới</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview.map((p) => (
                      <tr key={p.productId}>
                        <td className="tabular">{p.code}</td>
                        <td>
                          <span className="num">{formatMoney(p.oldPrice)}</span>
                        </td>
                        <td>
                          <span className="num">{formatMoney(p.newPrice)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {preview.affected > preview.preview.length && (
              <p className="muted">Chỉ hiện {preview.preview.length} dòng đầu.</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Đóng
          </Button>
          <Button variant="outline" onClick={() => run(true)} disabled={!canSubmit}>
            {mutation.isPending && !preview ? 'Đang tính…' : 'Xem trước'}
          </Button>
          <Button
            onClick={() => run(false)}
            disabled={!canSubmit || !preview || preview.affected === 0 || pendingCount > 0}
          >
            Áp dụng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
