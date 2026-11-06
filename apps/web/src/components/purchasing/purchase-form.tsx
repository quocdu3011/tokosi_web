'use client';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/common/field';
import { DialogHeader, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { api, ApiError, errorMessage } from '@/lib/api';
import type { PurchaseDocument } from '@/lib/api/types';
import {
  buildPurchaseInput,
  decimalSubtract,
  PURCHASE_CONFIG,
  type PurchaseDraft,
  type PurchaseKind,
  type PurchaseRow,
} from '@/lib/purchasing';
import { usePurchaseMutation } from '@/lib/queries/purchasing';
import { SupplierPicker } from './supplier-picker';
import { PurchaseLines } from './purchase-lines';
import { ReferencePicker } from './reference-picker';
import { FilterSelect } from './purchase-ui';

export interface PurchaseFormTarget {
  kind: PurchaseKind;
  edit?: PurchaseDocument;
  source?: PurchaseDocument;
}
function sourceRows(source: PurchaseDocument, kind: PurchaseKind): PurchaseRow[] {
  return (source.items ?? [])
    .map((r) => ({
      productId: r.productId,
      code: r.code,
      name: r.name,
      qty:
        kind === 'receipts' && 'remainingQty' in r
          ? r.remainingQty
          : kind === 'returns' && 'returnedQty' in r
            ? decimalSubtract(r.qty, r.returnedQty)
            : r.qty,
      unitCost: 'unitCost' in r ? r.unitCost : r.returnPrice,
    }))
    .filter((r) => !/^0(?:\.0+)?$/.test(r.qty));
}
function localDate(iso: string) {
  return new Date(new Date(iso).getTime() + 7 * 3600000).toISOString().slice(0, 16);
}
export function PurchaseForm({
  target,
  onClose,
  onSaved,
}: {
  target: PurchaseFormTarget;
  onClose: () => void;
  onSaved: (doc: PurchaseDocument) => void;
}) {
  const { kind, edit, source } = target;
  const initial = edit ?? source;
  const [supplier, setSupplier] = useState<{ id: string; name: string } | null>(
    initial?.supplier ?? null,
  );
  const [draft, setDraft] = useState<PurchaseDraft>({
    supplierId: initial?.supplier.id ?? '',
    note: edit?.note ?? '',
    date: edit && 'orderedAt' in edit ? localDate(edit.orderedAt) : '',
    referenceId: source?.id ?? '',
    status: edit?.status === 'confirmed' ? 'confirmed' : 'draft',
    items: initial ? sourceRows(initial, kind) : [],
  });
  const [referenceCode, setReferenceCode] = useState(source?.code ?? '');
  const [chooseReference, setChooseReference] = useState(false);
  const [error, setError] = useState('');
  const [details, setDetails] = useState<string[]>([]);
  const request = useRef<{ signature: string; key: string } | null>(null);
  const save = usePurchaseMutation(kind);
  const [loadingReference, setLoadingReference] = useState(false);
  const busy = save.isPending || loadingReference;
  return (
    <Sheet open onOpenChange={(open) => !open && !busy && onClose()}>
      <SheetContent
        side="right"
        className="purchase-workspace"
        aria-describedby={undefined}
        showCloseButton={!busy}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
      >
        <DialogHeader>
          <SheetTitle>
            {edit ? `Sửa ${edit.code}` : `Tạo phiếu · ${PURCHASE_CONFIG[kind].title}`}
          </SheetTitle>
        </DialogHeader>
        <form
          className="stack-md"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setError('');
            setDetails([]);
            if (!supplier || !draft.items.length) {
              setError('Chọn nhà cung cấp và ít nhất một mặt hàng.');
              return;
            }
            if (
              draft.items.some(
                (r) =>
                  !/^\d+(\.\d{1,3})?$/.test(r.qty) ||
                  /^0+(\.0+)?$/.test(r.qty) ||
                  !/^\d+(\.\d{1,4})?$/.test(r.unitCost),
              )
            ) {
              setError('Số lượng phải lớn hơn 0 (tối đa 3 số lẻ); giá không âm (tối đa 4 số lẻ).');
              return;
            }
            try {
              const value = { ...draft, supplierId: supplier.id };
              const signature = JSON.stringify(buildPurchaseInput(kind, value));
              if (request.current?.signature !== signature)
                request.current = { signature, key: crypto.randomUUID() };
              const doc = edit
                ? await save.mutateAsync({ action: 'update', id: edit.id, draft: value })
                : await save.mutateAsync({
                    action: 'create',
                    draft: value,
                    key: request.current.key,
                  });
              toast.success('Đã lưu chứng từ');
              onSaved(doc);
            } catch (err) {
              setError(errorMessage(err));
              if (err instanceof ApiError)
                setDetails(err.fieldErrors.map((f) => `${f.field}: ${f.message}`));
            }
          }}
        >
          <fieldset className="fieldset" disabled={busy}>
            <legend>Nhà cung cấp</legend>
            <SupplierPicker
              value={supplier}
              activeOnly
              onChange={(s) => {
                setSupplier(s);
                setDraft({
                  ...draft,
                  supplierId: s?.id ?? '',
                  referenceId: '',
                  items: draft.referenceId ? [] : draft.items,
                });
                setReferenceCode('');
                setChooseReference(false);
              }}
            />
          </fieldset>
          <div className="form-grid">
            <Field
              id="purchase-date"
              label="Thời gian (giờ Việt Nam)"
              hint="Bỏ trống để lấy thời gian hiện tại"
            >
              <Input
                id="purchase-date"
                type="datetime-local"
                disabled={busy}
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              />
            </Field>
            {kind === 'orders' && (
              <Field id="purchase-status" label="Trạng thái">
                <FilterSelect
                  id="purchase-status"
                  label="Trạng thái"
                  disabled={busy}
                  value={draft.status}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      status: value === 'confirmed' ? 'confirmed' : 'draft',
                    })
                  }
                  options={[
                    { value: 'draft', label: 'Phiếu tạm' },
                    { value: 'confirmed', label: 'Đã xác nhận NCC' },
                  ]}
                />
              </Field>
            )}
          </div>
          {kind !== 'orders' && (
            <section className="stack-sm">
              <div className="cell-badges">
                <span>{referenceCode ? `Phiếu gốc: ${referenceCode}` : 'Lập phiếu trực tiếp'}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!supplier || busy}
                  onClick={() => setChooseReference(!chooseReference)}
                >
                  Chọn phiếu gốc
                </Button>
                {referenceCode && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setDraft({ ...draft, referenceId: '' });
                      setReferenceCode('');
                    }}
                  >
                    Bỏ liên kết
                  </Button>
                )}
              </div>
              {chooseReference && supplier && (
                <ReferencePicker
                  kind={kind === 'receipts' ? 'orders' : 'receipts'}
                  supplierId={supplier.id}
                  onSelect={async (doc) => {
                    setLoadingReference(true);
                    try {
                      const full = await api.get<PurchaseDocument>(
                        `${kind === 'receipts' ? '/purchase-orders' : '/goods-receipts'}/${doc.id}`,
                      );
                      setDraft({ ...draft, referenceId: full.id, items: sourceRows(full, kind) });
                      setReferenceCode(full.code);
                      setChooseReference(false);
                      setError('');
                    } catch (err) {
                      setError(errorMessage(err));
                    } finally {
                      setLoadingReference(false);
                    }
                  }}
                />
              )}
            </section>
          )}
          <PurchaseLines
            rows={draft.items}
            returns={kind === 'returns'}
            disabled={busy}
            onChange={(items) => setDraft({ ...draft, items })}
          />
          <Field id="purchase-note" label="Ghi chú">
            <textarea
              id="purchase-note"
              className="form-input"
              rows={3}
              value={draft.note}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </Field>
          {kind !== 'orders' && (
            <p className="field-hint">
              Phiếu ghi nhận tồn kho và công nợ. Thanh toán hoặc hoàn tiền thực hiện riêng ở Sổ quỹ.
            </p>
          )}
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
              {details.length > 0 && (
                <ul>
                  {details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Đóng
            </Button>
            <Button type="submit" disabled={busy || !supplier || !draft.items.length}>
              {busy ? 'Đang lưu…' : edit ? 'Lưu thay đổi' : 'Tạo phiếu'}
            </Button>
          </DialogFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
