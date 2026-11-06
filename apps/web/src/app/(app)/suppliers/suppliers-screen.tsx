'use client';
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable, type AppColumnDef } from '@/components/data-table/data-table';
import { sortableIdsOf } from '@/components/data-table/column-meta';
import { Pagination } from '@/components/data-table/pagination';
import {
  ColumnPicker,
  FilterSelect,
  TableSearch,
  TableToolbar,
  ToolbarCount,
  ToolbarEnd,
} from '@/components/data-table/table-toolbar';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { RequirePermission } from '@/components/common/require-permission';
import { StatusBadge } from '@/components/common/status-badge';
import { QueryError } from '@/components/purchasing/query-feedback';
import { ExportExcelButton } from '@/components/purchasing/purchase-ui';
import { api, errorMessage } from '@/lib/api';
import type { Supplier } from '@/lib/api/types';
import { useAuthStore } from '@/lib/auth/store';
import { useBranchStore } from '@/lib/branch';
import { can } from '@/lib/permissions';
import { formatMoney } from '@/lib/format';
import { saveBlob } from '@/lib/table-export';
import { useSupplierList, useSaveSupplier } from '@/lib/queries/suppliers';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useListState } from '@/hooks/use-list-state';
import { useTablePrefs } from '@/hooks/use-table-prefs';
import { PageHeader } from '@/components/common/coming-soon';
import { SupplierForm } from './supplier-form';
import { SupplierDetail } from './supplier-detail';

const TABLE_KEY = 'suppliers';
// '' = mọi giá trị (không lọc).
const INITIAL_FILTERS = { active: '', hasDebt: '', group: '' };
const INITIAL_SORT = { id: 'code', desc: false };
const EMPTY: Supplier[] = [];

export function SuppliersScreen() {
  const branchId = useBranchStore((s) => s.branchId);
  return (
    <RequirePermission anyOf={['purchase.view']}>
      <SupplierWorkspace key={branchId} />
    </RequirePermission>
  );
}
function SupplierWorkspace() {
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [toggle, setToggle] = useState<Supplier | null>(null);
  const [exporting, setExporting] = useState(false);
  const me = useAuthStore((s) => s.user);
  const edit = can(me, 'purchase.edit');
  const debt = can(me, 'debt.view');
  const save = useSaveSupplier();
  const columns = useMemo<AppColumnDef<Supplier>[]>(() => {
    const cols: AppColumnDef<Supplier>[] = [
      {
        id: 'code',
        header: 'Mã NCC',
        meta: { label: 'Mã NCC', width: 140, locked: true, sort: 'server' },
        cell: ({ row }) => (
          <button
            type="button"
            className="link-button tabular"
            aria-label={`Xem nhà cung cấp ${row.original.code}`}
            onClick={() => setDetail(row.original.id)}
          >
            {row.original.code}
          </button>
        ),
      },
      {
        id: 'name',
        header: 'Nhà cung cấp',
        meta: { label: 'Nhà cung cấp', width: 280, locked: true, sort: 'server' },
        cell: ({ row }) => <span className="cell-title">{row.original.name}</span>,
      },
      {
        id: 'group',
        header: 'Nhóm',
        meta: { label: 'Nhóm', width: 160, hiddenByDefault: true },
        cell: ({ row }) => row.original.groupName ?? '—',
      },
      {
        id: 'total',
        header: () => <span className="num">Tổng mua</span>,
        meta: { label: 'Tổng mua', width: 170 },
        cell: ({ row }) => <span className="num">{formatMoney(row.original.totalPurchase)}</span>,
      },
      {
        id: 'net',
        header: () => <span className="num">Mua trừ trả hàng</span>,
        meta: { label: 'Mua trừ trả hàng', width: 180, hiddenByDefault: true },
        cell: ({ row }) => <span className="num">{formatMoney(row.original.netPurchase)}</span>,
      },
    ];
    // Công nợ chỉ có khi đủ quyền: thiếu quyền thì không đưa cột vào mảng.
    if (debt) {
      cols.push({
        id: 'debt',
        header: () => <span className="num">Nợ cần trả</span>,
        meta: { label: 'Nợ cần trả', width: 170 },
        cell: ({ row }) => <span className="num">{formatMoney(row.original.balance)}</span>,
      });
    }
    cols.push({
      id: 'status',
      header: 'Trạng thái',
      meta: { label: 'Trạng thái', width: 160 },
      // Ngưng giao dịch giữ màu xám (neutral) như màn cũ, cố ý không theo ACTIVE_STATUS_TONES (danger).
      cell: ({ row }) => (
        <StatusBadge tone={row.original.isActive ? 'success' : 'neutral'}>
          {row.original.isActive ? 'Đang giao dịch' : 'Ngưng giao dịch'}
        </StatusBadge>
      ),
    });
    if (edit) {
      cols.push({
        id: 'actions',
        header: () => <span className="sr-only">Thao tác</span>,
        meta: { label: 'Thao tác', width: 160, locked: true },
        cell: ({ row }) => (
          <div className="cell-actions">
            <Button
              variant="outline"
              size="sm"
              aria-label={`Sửa nhà cung cấp ${row.original.code}`}
              onClick={() => setEditing(row.original)}
            >
              Sửa
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${row.original.isActive ? 'Ngưng giao dịch' : 'Mở lại giao dịch'} ${row.original.code}`}
              onClick={() => setToggle(row.original)}
            >
              {row.original.isActive ? 'Ngưng' : 'Mở lại'}
            </Button>
          </div>
        ),
      });
    }
    return cols;
  }, [debt, edit]);
  const prefs = useTablePrefs(TABLE_KEY, columns);
  const list = useListState({
    initialFilters: INITIAL_FILTERS,
    initialSort: INITIAL_SORT,
    prefs,
  });
  const serverSortIds = sortableIdsOf(columns, 'server');
  const groupTerm = useDebouncedValue(list.filters.group.trim(), 300);
  const filters = {
    q: list.debouncedQ,
    groupName: groupTerm,
    isActive: list.filters.active ? list.filters.active === 'true' : undefined,
    hasDebt: debt && list.filters.hasDebt ? list.filters.hasDebt === 'true' : undefined,
    // Bỏ sắp xếp trên tiêu đề → về mặc định theo mã.
    sort:
      list.sort && serverSortIds.includes(list.sort.id)
        ? `${list.sort.desc ? '-' : ''}${list.sort.id}`
        : 'code',
  };
  const query = useSupplierList(
    { ...filters, page: list.page, limit: list.pageSize },
    prefs.isReady,
  );
  const rows = query.data?.data ?? EMPTY;
  return (
    <div className="page">
      <PageHeader
        title="Nhà cung cấp"
        description="Thông tin giao dịch và công nợ tại chi nhánh đang làm việc."
        actions={
          edit && (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden="true" />
              Thêm nhà cung cấp
            </Button>
          )
        }
      />
      <TableToolbar>
        <TableSearch
          value={list.q}
          onChange={list.setQ}
          placeholder="Tìm mã hoặc tên nhà cung cấp"
          label="Tìm nhà cung cấp"
        />
        <FilterSelect
          label="Trạng thái giao dịch"
          value={list.filters.active}
          onChange={(v) => list.setFilter('active', v)}
          options={[
            { value: '', label: 'Mọi trạng thái' },
            { value: 'true', label: 'Đang giao dịch' },
            { value: 'false', label: 'Ngưng giao dịch' },
          ]}
        />
        {debt && (
          <FilterSelect
            label="Lọc công nợ"
            value={list.filters.hasDebt}
            onChange={(v) => list.setFilter('hasDebt', v)}
            options={[
              { value: '', label: 'Mọi công nợ' },
              { value: 'true', label: 'Đang nợ' },
              { value: 'false', label: 'Không nợ' },
            ]}
          />
        )}
        <Input
          className="purchase-group-filter"
          aria-label="Nhóm nhà cung cấp"
          placeholder="Lọc theo nhóm"
          value={list.filters.group}
          onChange={(e) => list.setFilter('group', e.target.value)}
        />
        <ToolbarEnd>
          {query.data && <ToolbarCount total={query.data.meta.total} />}
          <ColumnPicker prefs={prefs} />
          <ExportExcelButton
            exporting={exporting}
            disabled={!query.data?.meta.total}
            onExport={async () => {
              setExporting(true);
              try {
                const file = await api.download('/suppliers', {
                  query: { ...filters, format: 'xlsx' },
                });
                saveBlob(file.blob, file.filename ?? 'nha-cung-cap.xlsx');
              } catch (e) {
                toast.error(errorMessage(e));
              } finally {
                setExporting(false);
              }
            }}
          />
        </ToolbarEnd>
      </TableToolbar>
      {query.isError ? (
        <QueryError error={query.error} retry={query.refetch} />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={rows}
            isLoading={query.isLoading || !prefs.isReady}
            getRowId={(s) => s.id}
            onRowClick={(s) => setDetail(s.id)}
            prefs={prefs}
            sort={list.sort}
            onSortChange={list.onSortChange}
            emptyText="Không có nhà cung cấp phù hợp"
          />
          <Pagination
            meta={query.data?.meta}
            onPageChange={list.setPage}
            pageSize={list.pageSize}
            onPageSizeChange={list.onPageSizeChange}
          />
        </>
      )}
      {editing && (
        <SupplierForm
          supplier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {detail && <SupplierDetail id={detail} onClose={() => setDetail(null)} />}
      {toggle && (
        <ConfirmDialog
          title={toggle.isActive ? 'Ngưng giao dịch?' : 'Mở lại giao dịch?'}
          description={toggle.name}
          confirmLabel="Xác nhận"
          onClose={() => setToggle(null)}
          onConfirm={() =>
            save.mutateAsync({ id: toggle.id, input: { isActive: !toggle.isActive } })
          }
        />
      )}
    </div>
  );
}
