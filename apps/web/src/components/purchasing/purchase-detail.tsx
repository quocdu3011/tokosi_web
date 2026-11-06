'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DialogHeader } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { useAuthStore } from '@/lib/auth/store';
import { can } from '@/lib/permissions';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatDecimal, formatMoney } from '@/lib/format';
import {
  documentDate,
  purchaseActions,
  PURCHASE_CONFIG,
  PURCHASE_STATUS,
  RECEIVE_STATUS,
  type PurchaseKind,
} from '@/lib/purchasing';
import { usePurchaseDocument, usePurchaseMutation } from '@/lib/queries/purchasing';
import { QueryError } from './query-feedback';
import type { PurchaseFormTarget } from './purchase-form';

export function PurchaseDetail({
  kind,
  id,
  onClose,
  onForm,
  onNavigate,
}: {
  kind: PurchaseKind;
  id: string;
  onClose: () => void;
  onForm: (target: PurchaseFormTarget) => void;
  onNavigate: (kind: PurchaseKind, id: string) => void;
}) {
  const query = usePurchaseDocument(kind, id);
  const doc = query.data;
  const save = usePurchaseMutation(kind);
  const me = useAuthStore((s) => s.user);
  const [note, setNote] = useState<string | null>(null);
  const [action, setAction] = useState<'confirm' | 'complete' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const actions = doc ? purchaseActions(kind, doc) : null;
  const edit = can(me, 'purchase.edit');
  const cancel = can(me, 'purchase.cancel');
  const labels = { confirm: 'Xác nhận NCC', complete: 'Kết thúc phiếu đặt', cancel: 'Hủy phiếu' };
  return (
    <Sheet open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <SheetContent
        side="right"
        className="purchase-workspace"
        aria-describedby={undefined}
        showCloseButton={!save.isPending}
      >
        <DialogHeader>
          <SheetTitle>
            {PURCHASE_CONFIG[kind].title} {doc?.code ?? ''}
          </SheetTitle>
        </DialogHeader>
        {query.isLoading && <p>Đang tải chi tiết…</p>}
        {query.isError && <QueryError error={query.error} retry={query.refetch} />}
        {doc && actions && (
          <>
            <div className="purchase-summary">
              <div>
                <span className="muted">Nhà cung cấp</span>
                <p>
                  {doc.supplier.code} · {doc.supplier.name}
                </p>
              </div>
              <div>
                <span className="muted">Ngày chứng từ</span>
                <p>{formatDateTime(documentDate(doc))}</p>
              </div>
              <div>
                <span className="muted">Trạng thái</span>
                <p>
                  {PURCHASE_STATUS[doc.status]}
                  {'receiveState' in doc ? ` · ${RECEIVE_STATUS[doc.receiveState]}` : ''}
                </p>
              </div>
              <div>
                <span className="muted">Tổng tiền</span>
                <p>{formatMoney(doc.total)}</p>
              </div>
            </div>
            <p className="muted">
              Người thực hiện:{' '}
              {('orderedBy' in doc
                ? doc.orderedBy
                : 'receivedBy' in doc
                  ? doc.receivedBy
                  : doc.returnedBy
              )?.fullName ?? '—'}{' '}
              · Người tạo: {doc.createdBy?.fullName ?? '—'} · {formatDateTime(doc.createdAt)}
            </p>
            <div className="cell-badges">
              {'purchaseOrder' in doc && doc.purchaseOrder && (
                <Button variant="link" onClick={() => onNavigate('orders', doc.purchaseOrder!.id)}>
                  Phiếu đặt: {doc.purchaseOrder.code}
                </Button>
              )}
              {'goodsReceipt' in doc && doc.goodsReceipt && (
                <Button variant="link" onClick={() => onNavigate('receipts', doc.goodsReceipt!.id)}>
                  Phiếu nhập: {doc.goodsReceipt.code}
                </Button>
              )}
              {'receipts' in doc &&
                doc.receipts?.map((r) => (
                  <Button variant="link" key={r.id} onClick={() => onNavigate('receipts', r.id)}>
                    Phiếu nhập: {r.code}
                  </Button>
                ))}
            </div>
            <div className="data-table-frame">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Hàng hóa</th>
                    <th>Số lượng</th>
                    <th>Đơn giá</th>
                    <th>Thành tiền</th>
                    {kind === 'orders' && (
                      <>
                        <th>Đã nhập</th>
                        <th>Còn nhập</th>
                      </>
                    )}
                    {kind === 'receipts' && <th>Đã trả</th>}
                  </tr>
                </thead>
                <tbody>
                  {doc.items?.map((r) => (
                    <tr key={r.productId}>
                      <td>
                        <b>{r.code}</b>
                        <div>{r.name}</div>
                      </td>
                      <td>{formatDecimal(r.qty)}</td>
                      <td>{formatMoney('unitCost' in r ? r.unitCost : r.returnPrice)}</td>
                      <td>{formatMoney(r.lineTotal)}</td>
                      {'receivedQty' in r && (
                        <>
                          <td>{formatDecimal(r.receivedQty)}</td>
                          <td>{formatDecimal(r.remainingQty)}</td>
                        </>
                      )}
                      {'returnedQty' in r && <td>{formatDecimal(r.returnedQty)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              {doc.itemCount} mặt hàng · Tổng số lượng {formatDecimal(doc.totalQty)}
            </p>
            <p>Ghi chú: {doc.note || '—'}</p>
            {doc.cancelledAt && (
              <p className="alert alert-error">
                Đã hủy {formatDateTime(doc.cancelledAt)} · {doc.cancelReason || 'Không ghi lý do'}
              </p>
            )}
            <div className="cell-badges">
              {edit && kind === 'orders' && actions.edit && (
                <Button variant="outline" onClick={() => onForm({ kind, edit: doc })}>
                  Sửa phiếu đặt
                </Button>
              )}
              {edit && kind !== 'orders' && actions.edit && (
                <Button variant="outline" onClick={() => setNote(doc.note ?? '')}>
                  Sửa ghi chú
                </Button>
              )}
              {edit && actions.confirm && (
                <Button onClick={() => setAction('confirm')}>Xác nhận NCC</Button>
              )}
              {edit && actions.complete && (
                <Button variant="outline" onClick={() => setAction('complete')}>
                  Kết thúc
                </Button>
              )}
              {edit &&
                kind === 'orders' &&
                (doc.status === 'draft' || doc.status === 'confirmed') && (
                  <Button onClick={() => onForm({ kind: 'receipts', source: doc })}>
                    Nhập hàng từ phiếu đặt
                  </Button>
                )}
              {edit && kind === 'receipts' && doc.status === 'completed' && (
                <Button onClick={() => onForm({ kind: 'returns', source: doc })}>
                  Trả hàng từ phiếu nhập
                </Button>
              )}
              {cancel && actions.cancel && (
                <Button variant="destructive" onClick={() => setAction('cancel')}>
                  Hủy phiếu
                </Button>
              )}
            </div>
            {note !== null && (
              <form
                className="stack-sm"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await save.mutateAsync({ action: 'note', id, note });
                    setNote(null);
                    toast.success('Đã lưu ghi chú');
                  } catch (err) {
                    toast.error(errorMessage(err));
                  }
                }}
              >
                <label htmlFor="edit-purchase-note">Ghi chú mới</label>
                <textarea
                  id="edit-purchase-note"
                  className="form-input"
                  value={note}
                  disabled={save.isPending}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="cell-badges">
                  <Button disabled={save.isPending}>Lưu ghi chú</Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={save.isPending}
                    onClick={() => setNote(null)}
                  >
                    Bỏ qua
                  </Button>
                </div>
              </form>
            )}
            {action && (
              <ConfirmDialog
                title={`${labels[action]} ${doc.code}?`}
                description={
                  <span>
                    {action === 'cancel'
                      ? 'Phiếu sẽ được hủy; tồn kho và công nợ được điều chỉnh tương ứng.'
                      : action === 'complete'
                        ? 'Đóng phần hàng NCC chưa giao. Phần còn lại không còn tính vào đang đặt NCC.'
                        : 'Xác nhận phiếu đặt với nhà cung cấp.'}
                    {action === 'cancel' && (
                      <label>
                        Lý do hủy
                        <textarea
                          className="form-input"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </label>
                    )}
                  </span>
                }
                confirmLabel={labels[action]}
                destructive={action === 'cancel'}
                onClose={() => setAction(null)}
                onConfirm={() => save.mutateAsync({ action, id, reason })}
              />
            )}
          </>
        )}
        <Button variant="outline" disabled={save.isPending} onClick={onClose}>
          Đóng
        </Button>
      </SheetContent>
    </Sheet>
  );
}
