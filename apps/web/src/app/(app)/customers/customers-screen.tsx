'use client';

import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { CUSTOMER_PRICE_LEVELS } from '@kiot/shared';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/coming-soon';
import { RequirePermission } from '@/components/common/require-permission';
import { StatusBadge, ACTIVE_STATUS_TONES } from '@/components/common/status-badge';
import { DataTable, type AppColumnDef } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import {
  ColumnPicker,
  FilterSelect,
  ImportButton,
  TableSearch,
  TableToolbar,
  ToolbarCount,
  ToolbarEnd,
} from '@/components/data-table/table-toolbar';
import { ImportDialog } from '@/components/import/import-dialog';
import { QueryError } from '@/components/purchasing/query-feedback';
import { ExportExcelButton } from '@/components/purchasing/purchase-ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/common/field';
import { useListState } from '@/hooks/use-list-state';
import { useTablePrefs } from '@/hooks/use-table-prefs';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { api, errorMessage } from '@/lib/api';
import type { Customer } from '@/lib/api/types';
import { useAuthStore } from '@/lib/auth/store';
import { useBranchStore } from '@/lib/branch';
import { workingCustomerFigures } from '@/lib/customers';
import { can, scopeOf } from '@/lib/permissions';
import { formatDate, formatMoney } from '@/lib/format';
import { useCustomerList } from '@/lib/queries/customers';
import { saveBlob } from '@/lib/table-export';
import { CustomerForm } from './customer-form';
import { CustomerDetail } from './customer-detail';

const TABLE_KEY = 'customers';
const INITIAL_FILTERS = {
  active: 'true',
  level: '',
  debt: '',
  owner: '',
  source: '',
  from: '',
  to: '',
};
const INITIAL_SORT = { id: 'code', desc: false };
const EMPTY: Customer[] = [];

export function CustomersScreen() {
  const branchId = useBranchStore((s) => s.branchId);
  return (
    <RequirePermission anyOf={['customer.view']}>
      <CustomerWorkspace key={branchId} />
    </RequirePermission>
  );
}

function CustomerWorkspace() {
  const me = useAuthStore((s) => s.user);
  const branchId = useBranchStore((s) => s.branchId);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const debt = can(me, 'debt.view');
  const columns = useMemo<AppColumnDef<Customer>[]>(() => {
    const cols: AppColumnDef<Customer>[] = [
      {
        id: 'code',
        header: 'Mã khách hàng',
        meta: { label: 'Mã khách hàng', width: 150, locked: true, sort: 'server' },
        cell: ({ row }) => (
          <button
            type="button"
            className="link-button tabular"
            aria-label={`Xem khách hàng ${row.original.code}`}
            onClick={() => setDetail(row.original.id)}
          >
            {row.original.code}
          </button>
        ),
      },
      {
        id: 'name',
        header: 'Khách hàng',
        meta: { label: 'Khách hàng', width: 270, locked: true, sort: 'server' },
        cell: ({ row }) => <span className="cell-title">{row.original.name}</span>,
      },
      {
        id: 'phone',
        header: 'Điện thoại',
        meta: { label: 'Điện thoại', width: 150 },
        cell: ({ row }) => row.original.phone ?? '—',
      },
      {
        id: 'salesOwner',
        header: 'Sale phụ trách',
        meta: { label: 'Sale phụ trách', width: 180 },
        cell: ({ row }) => row.original.salesOwner?.fullName ?? 'Chưa phân công',
      },
      {
        id: 'priceLevel',
        header: 'Level giá',
        meta: { label: 'Level giá', width: 120 },
        cell: ({ row }) => CUSTOMER_PRICE_LEVELS[row.original.priceLevel],
      },
      {
        id: 'totalSales',
        header: 'Tổng bán',
        meta: { label: 'Tổng bán', width: 175 },
        cell: ({ row }) => (
          <span className="num">
            {formatMoney(workingCustomerFigures(row.original, branchId)?.totalSales) || '—'}
          </span>
        ),
      },
      {
        id: 'netSales',
        header: 'Bán trừ trả hàng',
        meta: { label: 'Bán trừ trả hàng', width: 175, hiddenByDefault: true },
        cell: ({ row }) => (
          <span className="num">
            {formatMoney(workingCustomerFigures(row.original, branchId)?.netSales) || '—'}
          </span>
        ),
      },
    ];
    if (debt)
      cols.push({
        id: 'balance',
        header: 'Nợ cần thu',
        meta: { label: 'Nợ cần thu', width: 175 },
        cell: ({ row }) => (
          <span className="num">
            {formatMoney(workingCustomerFigures(row.original, branchId)?.balance) || '—'}
          </span>
        ),
      });
    cols.push(
      {
        id: 'newSince',
        header: 'Khách mới từ',
        meta: { label: 'Khách mới từ', width: 150, sort: 'server', hiddenByDefault: true },
        cell: ({ row }) => row.original.newSince?.slice(0, 7).split('-').reverse().join('/') || '—',
      },
      {
        id: 'acquisitionSource',
        header: 'Nguồn khách',
        meta: { label: 'Nguồn khách', width: 150, hiddenByDefault: true },
        cell: ({ row }) => row.original.acquisitionSource ?? '—',
      },
      {
        id: 'lastVisitedOn',
        header: 'Tiếp khách gần nhất',
        meta: { label: 'Tiếp khách gần nhất', width: 170, hiddenByDefault: true },
        cell: ({ row }) => formatDate(row.original.lastVisitedOn) || '—',
      },
      {
        id: 'status',
        header: 'Trạng thái',
        meta: { label: 'Trạng thái', width: 160 },
        cell: ({ row }) => (
          <StatusBadge tone={ACTIVE_STATUS_TONES[row.original.isActive ? 'active' : 'inactive']}>
            {row.original.isActive ? 'Đang giao dịch' : 'Ngưng giao dịch'}
          </StatusBadge>
        ),
      },
    );
    return cols;
  }, [branchId, debt]);
  const prefs = useTablePrefs(TABLE_KEY, columns);
  const list = useListState({ initialFilters: INITIAL_FILTERS, initialSort: INITIAL_SORT, prefs });
  const source = useDebouncedValue(list.filters.source.trim(), 300);
  const filters = {
    q: list.debouncedQ,
    isActive: list.filters.active ? list.filters.active === 'true' : undefined,
    priceLevel: (list.filters.level || undefined) as Customer['priceLevel'] | undefined,
    hasDebt: debt && list.filters.debt ? list.filters.debt === 'true' : undefined,
    salesOwnerId: list.filters.owner ? me?.id : undefined,
    acquisitionSource: source,
    newSinceFrom: list.filters.from,
    newSinceTo: list.filters.to,
    sort: list.sort ? `${list.sort.desc ? '-' : ''}${list.sort.id}` : 'code',
  };
  const invalidRange =
    !!filters.newSinceFrom && !!filters.newSinceTo && filters.newSinceFrom > filters.newSinceTo;
  const query = useCustomerList(
    { ...filters, page: list.page, limit: list.pageSize },
    prefs.isReady && !invalidRange,
  );
  return (
    <div className="page">
      <PageHeader
        title="Khách hàng"
        description="Hồ sơ khách hàng và công nợ tại chi nhánh đang làm việc."
        actions={
          can(me, 'customer.edit') && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              Thêm khách hàng
            </Button>
          )
        }
      />
      <TableToolbar>
        <TableSearch
          value={list.q}
          onChange={list.setQ}
          placeholder="Tìm mã, tên hoặc số điện thoại"
          label="Tìm khách hàng"
        />
        <FilterSelect
          label="Trạng thái khách hàng"
          value={list.filters.active}
          onChange={(v) => list.setFilter('active', v)}
          options={[
            { value: '', label: 'Mọi trạng thái' },
            { value: 'true', label: 'Đang giao dịch' },
            { value: 'false', label: 'Ngưng giao dịch' },
          ]}
        />
        <FilterSelect
          label="Level giá"
          value={list.filters.level}
          onChange={(v) => list.setFilter('level', v)}
          options={[
            { value: '', label: 'Mọi level giá' },
            ...Object.entries(CUSTOMER_PRICE_LEVELS).map(([value, label]) => ({ value, label })),
          ]}
        />
        <FilterSelect
          label="Sale phụ trách"
          value={list.filters.owner}
          onChange={(v) => list.setFilter('owner', v)}
          options={[
            { value: '', label: 'Mọi nhân viên' },
            { value: 'me', label: 'Tôi phụ trách' },
          ]}
        />
        {debt && (
          <FilterSelect
            label="Công nợ khách hàng"
            value={list.filters.debt}
            onChange={(v) => list.setFilter('debt', v)}
            options={[
              { value: '', label: 'Mọi công nợ' },
              { value: 'true', label: 'Đang nợ' },
              { value: 'false', label: 'Không nợ' },
            ]}
          />
        )}
        <ToolbarEnd>
          {query.data && <ToolbarCount total={query.data.meta.total} />}
          <ColumnPicker prefs={prefs} />
          {can(me, 'import.run') && scopeOf(me, 'customer.edit') === 'all' && (
            <ImportButton onClick={() => setImporting(true)} />
          )}
          <ExportExcelButton
            exporting={exporting}
            disabled={!query.data?.meta.total || invalidRange}
            onExport={async () => {
              setExporting(true);
              try {
                const file = await api.download('/customers', {
                  query: { ...filters, format: 'xlsx' },
                  branchId,
                });
                saveBlob(file.blob, file.filename ?? 'khach-hang.xlsx');
              } catch (error) {
                toast.error(errorMessage(error));
              } finally {
                setExporting(false);
              }
            }}
          />
        </ToolbarEnd>
      </TableToolbar>
      <div className="purchase-filters">
        <Field id="customer-source-filter" label="Nguồn khách">
          <Input
            id="customer-source-filter"
            placeholder="Ví dụ: Page"
            maxLength={100}
            value={list.filters.source}
            onChange={(e) => list.setFilter('source', e.target.value)}
          />
        </Field>
        <Field id="customer-month-from" label="Khách mới từ tháng">
          <Input
            id="customer-month-from"
            type="month"
            value={list.filters.from}
            onChange={(e) => list.setFilter('from', e.target.value)}
          />
        </Field>
        <Field id="customer-month-to" label="Đến tháng">
          <Input
            id="customer-month-to"
            type="month"
            value={list.filters.to}
            onChange={(e) => list.setFilter('to', e.target.value)}
          />
        </Field>
      </div>
      {invalidRange ? (
        <p className="alert alert-error" role="alert">
          Tháng bắt đầu phải trước hoặc bằng tháng kết thúc.
        </p>
      ) : query.isError ? (
        <QueryError error={query.error} retry={query.refetch} />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={query.data?.data ?? EMPTY}
            isLoading={query.isLoading || !prefs.isReady}
            getRowId={(c) => c.id}
            onRowClick={(c) => setDetail(c.id)}
            prefs={prefs}
            sort={list.sort}
            onSortChange={list.onSortChange}
            emptyText="Không có khách hàng phù hợp"
          />
          <Pagination
            meta={query.data?.meta}
            onPageChange={list.setPage}
            pageSize={list.pageSize}
            onPageSizeChange={list.onPageSizeChange}
          />
        </>
      )}
      {creating && <CustomerForm customer={null} onClose={() => setCreating(false)} />}
      {detail && <CustomerDetail id={detail} onClose={() => setDetail(null)} />}
      {importing && <ImportDialog type="customers" onClose={() => setImporting(false)} />}
    </div>
  );
}
