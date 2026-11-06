'use client';
import { useState } from 'react';
import { Info, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DialogHeader } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { DataTable, type AppColumnDef } from '@/components/data-table/data-table';
import { useSupplier, useSupplierBranches, useSupplierLedger } from '@/lib/queries/suppliers';
import { useAuthStore } from '@/lib/auth/store';
import { can } from '@/lib/permissions';
import { formatDateTime, formatMoney } from '@/lib/format';
import type { SupplierLedger } from '@/lib/api/types';
import { QueryError } from '@/components/purchasing/query-feedback';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const columns: AppColumnDef<SupplierLedger['entries'][number]>[] = [
  { id: 'date', header: 'Ngày', cell: ({ row }) => formatDateTime(row.original.occurredAt) },
  { id: 'ref', header: 'Chứng từ', cell: ({ row }) => row.original.refCode ?? '—' },
  { id: 'amount', header: 'Tăng/giảm nợ', cell: ({ row }) => formatMoney(row.original.amount) },
  { id: 'balance', header: 'Số dư', cell: ({ row }) => formatMoney(row.original.balance) },
  { id: 'note', header: 'Ghi chú', cell: ({ row }) => row.original.note ?? '—' },
];
export function SupplierDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [range, setRange] = useState({ from: '', to: '' });
  const [tab, setTab] = useState('info');
  const me = useAuthStore((s) => s.user);
  const debt = can(me, 'debt.view');
  const supplier = useSupplier(id);
  const branches = useSupplierBranches(id);
  const ledger = useSupplierLedger(
    id,
    range,
    debt && tab === 'ledger' && !(range.from && range.to && range.from > range.to),
  );
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="purchase-workspace" aria-describedby={undefined}>
        <DialogHeader>
          <SheetTitle>
            {supplier.data
              ? `${supplier.data.code} · ${supplier.data.name}`
              : 'Chi tiết nhà cung cấp'}
          </SheetTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab} className="product-workspace-tabs">
          <TabsList aria-label="Chi tiết nhà cung cấp">
            <TabsTrigger value="info">
              <Info aria-hidden="true" />
              Thông tin
            </TabsTrigger>
            {debt && (
              <TabsTrigger value="ledger">
                <BookOpen aria-hidden="true" />
                Sổ công nợ
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="info" className="stack-md">
            {supplier.isLoading && <p>Đang tải…</p>}
            {supplier.isError && <QueryError error={supplier.error} retry={supplier.refetch} />}
            {supplier.data && (
              <p className="muted">
                Nhóm: {supplier.data.groupName ?? 'Chưa phân nhóm'} ·{' '}
                {supplier.data.isActive ? 'Đang giao dịch' : 'Ngưng giao dịch'} · Người tạo:{' '}
                {supplier.data.createdByName ?? '—'}
              </p>
            )}
            <h3>Số liệu từng chi nhánh</h3>
            {branches.isError && <QueryError error={branches.error} retry={branches.refetch} />}
            {branches.isLoading && <p>Đang tải số liệu…</p>}
            <div className="purchase-branch-grid">
              {branches.data?.map((b) => (
                <section className="branch-card" key={b.branchId}>
                  <h4>{b.branchName}</h4>
                  <dl className="stack-sm">
                    <div>
                      <dt>Tổng mua</dt>
                      <dd>{formatMoney(b.totalPurchase)}</dd>
                    </div>
                    <div>
                      <dt>Tổng mua trừ trả hàng</dt>
                      <dd>{formatMoney(b.netPurchase)}</dd>
                    </div>
                    {b.balance !== undefined && (
                      <div>
                        <dt>Nợ cần trả</dt>
                        <dd>{formatMoney(b.balance)}</dd>
                      </div>
                    )}
                  </dl>
                </section>
              ))}
            </div>
          </TabsContent>
          {debt && (
            <TabsContent value="ledger" className="stack-md">
              <h3>Sổ công nợ tại chi nhánh đang làm việc</h3>
              <div className="cell-badges">
                <label>
                  Từ ngày
                  <Input
                    type="date"
                    value={range.from}
                    onChange={(e) => setRange({ ...range, from: e.target.value })}
                  />
                </label>
                <label>
                  Đến ngày
                  <Input
                    type="date"
                    value={range.to}
                    min={range.from}
                    onChange={(e) => setRange({ ...range, to: e.target.value })}
                  />
                </label>
              </div>
              {range.from && range.to && range.from > range.to ? (
                <p role="alert">Ngày kết thúc phải từ ngày bắt đầu trở đi.</p>
              ) : ledger.isError ? (
                <QueryError error={ledger.error} retry={ledger.refetch} />
              ) : (
                <>
                  <p>
                    Đầu kỳ: {formatMoney(ledger.data?.openingBalance) || '—'} · Cuối kỳ:{' '}
                    {formatMoney(ledger.data?.closingBalance) || '—'}
                  </p>
                  <DataTable
                    columns={columns}
                    data={ledger.data?.entries ?? []}
                    isLoading={ledger.isLoading}
                    emptyText="Không có phát sinh trong kỳ"
                  />
                </>
              )}
            </TabsContent>
          )}
        </Tabs>
        <Button variant="outline" onClick={onClose}>
          Đóng
        </Button>
      </SheetContent>
    </Sheet>
  );
}
