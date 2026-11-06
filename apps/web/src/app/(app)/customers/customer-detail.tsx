'use client';

import { useState } from 'react';
import { CUSTOMER_PRICE_LEVELS } from '@kiot/shared';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { DialogHeader } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/common/field';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { DataTable, type AppColumnDef } from '@/components/data-table/data-table';
import { QueryError } from '@/components/purchasing/query-feedback';
import { errorMessage } from '@/lib/api';
import type { Customer, CustomerLedger, CustomerVisit } from '@/lib/api/types';
import { useAuthStore } from '@/lib/auth/store';
import { useBranchStore } from '@/lib/branch';
import { customerAccess } from '@/lib/customers';
import { can } from '@/lib/permissions';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import {
  useCustomer,
  useSaveCustomer,
  useCustomerVisits,
  useCustomerVisitMutation,
  useSetCustomerTerms,
  useCustomerLedger,
} from '@/lib/queries/customers';
import { CustomerForm } from './customer-form';

export function CustomerDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useCustomer(id);
  const me = useAuthStore((s) => s.user);
  const [tab, setTab] = useState('info');
  const [editing, setEditing] = useState(false);
  const [toggle, setToggle] = useState(false);
  const save = useSaveCustomer();
  const customer = query.data;
  const access = customer ? customerAccess(me, customer) : { edit: false, debt: false };
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="purchase-workspace" aria-describedby={undefined}>
        <DialogHeader>
          <SheetTitle>
            {customer ? `${customer.code} · ${customer.name}` : 'Chi tiết khách hàng'}
          </SheetTitle>
        </DialogHeader>
        {query.isLoading && <p role="status">Đang tải khách hàng…</p>}
        {query.isError && <QueryError error={query.error} retry={query.refetch} />}
        {customer && (
          <>
            {customer.warnings?.map((w) => (
              <p key={w.code} className="alert alert-warning" role="status">
                {w.message}
              </p>
            ))}
            <Tabs value={tab} onValueChange={setTab} className="product-workspace-tabs">
              <TabsList aria-label="Chi tiết khách hàng">
                <TabsTrigger value="info">Thông tin</TabsTrigger>
                <TabsTrigger value="visits">Lịch tiếp khách</TabsTrigger>
                {access.debt && <TabsTrigger value="ledger">Sổ công nợ</TabsTrigger>}
              </TabsList>
              <TabsContent value="info" className="stack-md">
                <dl className="purchase-summary">
                  {Object.entries({
                    'Điện thoại': customer.phone,
                    'Địa chỉ': customer.address,
                    'Sale phụ trách': customer.salesOwner?.fullName,
                    'Level giá': CUSTOMER_PRICE_LEVELS[customer.priceLevel],
                    'Khách mới từ': customer.newSince?.slice(0, 7).split('-').reverse().join('/'),
                    'Nguồn khách': customer.acquisitionSource,
                    'Trạng thái': customer.isActive ? 'Đang giao dịch' : 'Ngưng giao dịch',
                    'Ghi chú': customer.note,
                    'Định vị kho': customer.profile?.warehouseLocation,
                    'Số kho': customer.profile?.warehouseCount,
                    'Diện tích kho': customer.profile?.warehouseArea,
                    'Ảnh kho': customer.profile?.warehousePhotoUrl,
                    'Đối thủ': customer.profile?.competitors,
                    'Quy mô': customer.profile?.scale,
                    'Hình thức bán hàng': customer.profile?.salesMethods.join(', '),
                    'Người tạo': customer.createdByName,
                  }).map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value ?? '—'}</dd>
                    </div>
                  ))}
                </dl>
                {access.edit && (
                  <div className="cell-actions">
                    <Button variant="outline" onClick={() => setEditing(true)}>
                      Sửa khách hàng
                    </Button>
                    <Button variant="outline" onClick={() => setToggle(true)}>
                      {customer.isActive ? 'Ngưng giao dịch' : 'Mở lại giao dịch'}
                    </Button>
                  </div>
                )}
                <h3>Số liệu từng chi nhánh</h3>
                <div className="purchase-branch-grid">
                  {customer.branches.map((b) => (
                    <section className="branch-card stack-sm" key={b.branchId}>
                      <h4>{b.branchName}</h4>
                      <dl className="stack-sm">
                        <div>
                          <dt>Tổng bán</dt>
                          <dd>{formatMoney(b.totalSales)}</dd>
                        </div>
                        <div>
                          <dt>Bán trừ trả hàng</dt>
                          <dd>{formatMoney(b.netSales)}</dd>
                        </div>
                        {access.debt && b.balance !== undefined && (
                          <>
                            <div>
                              <dt>Nợ cần thu</dt>
                              <dd>{formatMoney(b.balance)}</dd>
                            </div>
                            <div>
                              <dt>Hạn mức công nợ</dt>
                              <dd>
                                {b.creditLimit == null
                                  ? 'Không giới hạn'
                                  : formatMoney(b.creditLimit)}
                              </dd>
                            </div>
                            <div>
                              <dt>Kỳ hạn thanh toán</dt>
                              <dd>
                                {b.paymentTermDays == null
                                  ? 'Không quy định'
                                  : `${b.paymentTermDays} ngày`}
                              </dd>
                            </div>
                          </>
                        )}
                      </dl>
                      {access.edit && access.debt && b.balance !== undefined && (
                        <CustomerTerms
                          key={`${b.branchId}-${b.creditLimit}-${b.paymentTermDays}`}
                          id={id}
                          branch={b}
                        />
                      )}
                    </section>
                  ))}
                </div>
              </TabsContent>
              <TabsContent value="visits">
                {tab === 'visits' && <CustomerVisits id={id} />}
              </TabsContent>
              {access.debt && (
                <TabsContent value="ledger">
                  {tab === 'ledger' && <CustomerDebt id={id} />}
                </TabsContent>
              )}
            </Tabs>
            {editing && access.edit && (
              <CustomerForm customer={customer} onClose={() => setEditing(false)} />
            )}
            {toggle && access.edit && (
              <ConfirmDialog
                title={
                  customer.isActive ? 'Ngưng giao dịch khách hàng?' : 'Mở lại giao dịch khách hàng?'
                }
                description={customer.name}
                confirmLabel="Xác nhận"
                onClose={() => setToggle(false)}
                onConfirm={() => save.mutateAsync({ id, input: { isActive: !customer.isActive } })}
              />
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CustomerTerms({ id, branch }: { id: string; branch: Customer['branches'][number] }) {
  const save = useSetCustomerTerms(id, branch.branchId);
  const [error, setError] = useState('');
  return (
    <form
      className="stack-sm"
      onSubmit={async (event) => {
        event.preventDefault();
        setError('');
        const form = new FormData(event.currentTarget);
        const credit = String(form.get('credit') ?? '').trim();
        const days = String(form.get('days') ?? '').trim();
        try {
          await save.mutateAsync({
            creditLimit: credit || null,
            paymentTermDays: days ? Number(days) : null,
          });
          toast.success('Đã lưu hạn mức chi nhánh');
        } catch (err) {
          setError(errorMessage(err));
        }
      }}
    >
      <Field
        id={`ct-credit-${branch.branchId}`}
        label="Hạn mức (đồng)"
        hint="Bỏ trống = không giới hạn"
      >
        <Input
          id={`ct-credit-${branch.branchId}`}
          name="credit"
          defaultValue={branch.creditLimit ?? ''}
          inputMode="numeric"
          pattern="[0-9]{1,15}"
          maxLength={15}
          disabled={save.isPending}
        />
      </Field>
      <Field id={`ct-days-${branch.branchId}`} label="Kỳ hạn (ngày)">
        <Input
          id={`ct-days-${branch.branchId}`}
          name="days"
          type="number"
          min={0}
          max={3650}
          step={1}
          defaultValue={branch.paymentTermDays ?? ''}
          disabled={save.isPending}
        />
      </Field>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="outline" disabled={save.isPending}>
        {save.isPending ? 'Đang lưu…' : 'Lưu hạn mức'}
      </Button>
    </form>
  );
}

function CustomerVisits({ id }: { id: string }) {
  const query = useCustomerVisits(id);
  const mutation = useCustomerVisitMutation(id);
  const me = useAuthStore((s) => s.user);
  const edit = can(me, 'customer.visit.edit');
  const [removing, setRemoving] = useState<CustomerVisit | null>(null);
  const [error, setError] = useState('');
  const [today] = useState(() => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10));
  const columns: AppColumnDef<CustomerVisit>[] = [
    {
      id: 'visitedOn',
      header: 'Ngày tiếp khách',
      meta: { label: 'Ngày tiếp khách', width: 170 },
      cell: ({ row }) => formatDate(row.original.visitedOn),
    },
    {
      id: 'note',
      header: 'Ghi chú',
      meta: { label: 'Ghi chú', width: 250 },
      cell: ({ row }) => row.original.note ?? '—',
    },
    {
      id: 'createdByName',
      header: 'Người ghi',
      meta: { label: 'Người ghi', width: 170 },
      cell: ({ row }) => row.original.createdByName ?? '—',
    },
    ...(edit
      ? [
          {
            id: 'actions',
            header: 'Thao tác',
            meta: { label: 'Thao tác', width: 110 },
            cell: ({ row }: { row: { original: CustomerVisit } }) => (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Xóa ngày tiếp khách ${formatDate(row.original.visitedOn)}`}
                onClick={() => setRemoving(row.original)}
              >
                Xóa
              </Button>
            ),
          },
        ]
      : []),
  ];
  return (
    <div className="stack-md">
      {edit && (
        <form
          className="stack-sm"
          onSubmit={async (event) => {
            event.preventDefault();
            setError('');
            const element = event.currentTarget;
            const data = new FormData(element);
            try {
              await mutation.mutateAsync({
                visitedOn: String(data.get('visitedOn')),
                note: String(data.get('note') ?? '').trim() || null,
              });
              element.reset();
              toast.success('Đã ghi ngày tiếp khách');
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          <Field id="cv-date" label="Ngày tiếp khách">
            <Input
              id="cv-date"
              name="visitedOn"
              type="date"
              required
              max={today}
              defaultValue={today}
              disabled={mutation.isPending}
            />
          </Field>
          <Field id="cv-note" label="Ghi chú tiếp khách">
            <Input id="cv-note" name="note" maxLength={1000} disabled={mutation.isPending} />
          </Field>
          {error && (
            <p className="alert alert-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Đang ghi…' : 'Ghi ngày tiếp khách'}
          </Button>
        </form>
      )}
      {query.isError ? (
        <QueryError error={query.error} retry={query.refetch} />
      ) : (
        <DataTable
          columns={columns}
          data={query.data ?? []}
          getRowId={(v) => v.id}
          isLoading={query.isLoading}
          emptyText="Chưa ghi ngày tiếp khách"
        />
      )}
      {removing && (
        <ConfirmDialog
          title="Xóa ngày tiếp khách?"
          description={formatDate(removing.visitedOn)}
          confirmLabel="Xóa"
          destructive
          onClose={() => setRemoving(null)}
          onConfirm={() => mutation.mutateAsync({ removeId: removing.id })}
        />
      )}
    </div>
  );
}

const LEDGER_COLUMNS: AppColumnDef<CustomerLedger['entries'][number]>[] = [
  {
    id: 'date',
    header: 'Thời gian',
    meta: { label: 'Thời gian', width: 180 },
    cell: ({ row }) => formatDateTime(row.original.occurredAt),
  },
  {
    id: 'code',
    header: 'Chứng từ',
    meta: { label: 'Chứng từ', width: 160 },
    cell: ({ row }) => row.original.refCode ?? '—',
  },
  {
    id: 'amount',
    header: 'Phát sinh',
    meta: { label: 'Phát sinh', width: 170 },
    cell: ({ row }) => <span className="num">{formatMoney(row.original.amount)}</span>,
  },
  {
    id: 'balance',
    header: 'Số dư',
    meta: { label: 'Số dư', width: 170 },
    cell: ({ row }) => <span className="num">{formatMoney(row.original.balance)}</span>,
  },
  {
    id: 'note',
    header: 'Ghi chú',
    meta: { label: 'Ghi chú', width: 220 },
    cell: ({ row }) => row.original.note ?? '—',
  },
];
function CustomerDebt({ id }: { id: string }) {
  const [range, setRange] = useState({ from: '', to: '' });
  const branchId = useBranchStore((s) => s.branchId);
  const branchName = useAuthStore((s) => s.user?.branches.find((b) => b.id === branchId)?.name);
  const valid = !range.from || !range.to || range.from <= range.to;
  const query = useCustomerLedger(id, range, valid);
  return (
    <div className="stack-md">
      <p className="muted">Sổ công nợ · {branchName} · Phát sinh dương: tăng nợ; âm: giảm nợ.</p>
      <div className="purchase-filters">
        <Field id="cl-from" label="Từ ngày">
          <Input
            id="cl-from"
            type="date"
            value={range.from}
            onChange={(e) => setRange({ ...range, from: e.target.value })}
          />
        </Field>
        <Field id="cl-to" label="Đến ngày">
          <Input
            id="cl-to"
            type="date"
            value={range.to}
            onChange={(e) => setRange({ ...range, to: e.target.value })}
          />
        </Field>
      </div>
      {!valid ? (
        <p className="alert alert-error" role="alert">
          Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.
        </p>
      ) : query.isError ? (
        <QueryError error={query.error} retry={query.refetch} />
      ) : (
        <>
          {query.data && (
            <div className="purchase-summary">
              <div>
                Đầu kỳ<p>{formatMoney(query.data.openingBalance)}</p>
              </div>
              <div>
                Cuối kỳ<p>{formatMoney(query.data.closingBalance)}</p>
              </div>
            </div>
          )}
          <DataTable
            columns={LEDGER_COLUMNS}
            data={query.data?.entries ?? []}
            isLoading={query.isLoading}
            emptyText="Không có phát sinh công nợ trong khoảng ngày này"
          />
        </>
      )}
    </div>
  );
}
