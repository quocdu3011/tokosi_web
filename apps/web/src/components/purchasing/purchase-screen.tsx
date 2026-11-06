'use client';
import { useMemo, useState } from 'react';
import { Plus, Filter, X } from 'lucide-react';
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
import { RequirePermission } from '@/components/common/require-permission';
import { useAuthStore } from '@/lib/auth/store';
import { useBranchStore } from '@/lib/branch';
import { can } from '@/lib/permissions';
import { api, errorMessage } from '@/lib/api';
import type { PurchaseDocument } from '@/lib/api/types';
import { saveBlob } from '@/lib/table-export';
import { formatDateTime, formatMoney, formatDecimal } from '@/lib/format';
import {
  documentDate,
  PURCHASE_CONFIG,
  PURCHASE_STATUS,
  type PurchaseKind,
} from '@/lib/purchasing';
import { usePurchaseList } from '@/lib/queries/purchasing';
import { useListState } from '@/hooks/use-list-state';
import { useTablePrefs } from '@/hooks/use-table-prefs';
import { PageHeader } from '@/components/common/coming-soon';
import { ExportExcelButton, PurchaseStatus, ReceiveStatus } from './purchase-ui';
import { PurchaseDetail } from './purchase-detail';
import { PurchaseForm, type PurchaseFormTarget } from './purchase-form';
import { SupplierPicker } from './supplier-picker';
import { QueryError } from './query-feedback';

/** Mỗi loại chứng từ một khóa riêng để bố cục cột lưu tách nhau. */
const TABLE_KEYS: Record<PurchaseKind, string> = {
  orders: 'purchase-orders',
  receipts: 'goods-receipts',
  returns: 'purchase-returns',
};
// '' = không lọc.
const INITIAL_FILTERS = { status: '', from: '', to: '', supplierId: '' };
const EMPTY: PurchaseDocument[] = [];

export function PurchaseScreen({ kind }: { kind: PurchaseKind }) {
  const branchId = useBranchStore((s) => s.branchId);
  return (
    <RequirePermission anyOf={['purchase.view']}>
      <PurchaseWorkspace key={`${branchId}-${kind}`} kind={kind} />
    </RequirePermission>
  );
}
function PurchaseWorkspace({ kind }: { kind: PurchaseKind }) {
  const config = PURCHASE_CONFIG[kind];
  const defaultSort = `-${config.date}`;
  const [supplierName, setSupplierName] = useState('');
  const [filterSupplier, setFilterSupplier] = useState(false);
  const [detail, setDetail] = useState<{ kind: PurchaseKind; id: string } | null>(null);
  const [form, setForm] = useState<PurchaseFormTarget | null>(null);
  const [exporting, setExporting] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const me = useAuthStore((s) => s.user);
  const edit = can(me, 'purchase.edit');
  const columns = useMemo<AppColumnDef<PurchaseDocument>[]>(() => {
    const cols: AppColumnDef<PurchaseDocument>[] = [
      {
        id: 'code',
        header: 'Mã phiếu',
        meta: { label: 'Mã phiếu', width: 145, locked: true, sort: 'server' },
        cell: ({ row }) => (
          <button
            type="button"
            className="link-button tabular"
            aria-label={`Xem phiếu ${row.original.code}`}
            onClick={() => setDetail({ kind, id: row.original.id })}
          >
            {row.original.code}
          </button>
        ),
      },
      {
        id: 'date',
        header: 'Ngày chứng từ',
        meta: { label: 'Ngày chứng từ', width: 180, sort: 'server' },
        cell: ({ row }) => formatDateTime(documentDate(row.original)),
      },
      {
        id: 'supplier',
        header: 'Nhà cung cấp',
        meta: { label: 'Nhà cung cấp', width: 290, locked: true },
        cell: ({ row }) => <span className="cell-title">{row.original.supplier.name}</span>,
      },
      {
        id: 'qty',
        header: () => <span className="num">Tổng số lượng</span>,
        meta: { label: 'Tổng số lượng', width: 145, hiddenByDefault: true },
        cell: ({ row }) => <span className="num">{formatDecimal(row.original.totalQty)}</span>,
      },
      {
        id: 'total',
        header: () => <span className="num">Tổng tiền</span>,
        meta: { label: 'Tổng tiền', width: 180, sort: 'server' },
        cell: ({ row }) => <span className="num">{formatMoney(row.original.total)}</span>,
      },
      {
        id: 'status',
        header: 'Trạng thái',
        meta: { label: 'Trạng thái', width: 180 },
        cell: ({ row }) => <PurchaseStatus status={row.original.status} />,
      },
    ];
    if (kind === 'orders') {
      cols.push({
        id: 'receive',
        header: 'Tình trạng nhập',
        meta: { label: 'Tình trạng nhập', width: 170 },
        cell: ({ row }) =>
          'receiveState' in row.original ? (
            <ReceiveStatus state={row.original.receiveState} />
          ) : null,
      });
    }
    cols.push({
      id: 'note',
      header: 'Ghi chú',
      meta: { label: 'Ghi chú', width: 260, hiddenByDefault: true },
      cell: ({ row }) => row.original.note ?? '—',
    });
    return cols;
  }, [kind]);
  const prefs = useTablePrefs(TABLE_KEYS[kind], columns);
  const list = useListState({
    initialFilters: INITIAL_FILTERS,
    initialSort: { id: 'date', desc: true },
    prefs,
  });
  const { from, to } = list.filters;
  const serverSortIds = sortableIdsOf(columns, 'server');
  // Cột `date` trên bảng ứng với trường ngày riêng của từng loại chứng từ (config.date) ở API.
  const sortField = list.sort && serverSortIds.includes(list.sort.id) ? list.sort : null;
  const filters = {
    q: list.debouncedQ,
    supplierId: list.filters.supplierId || undefined,
    status: list.filters.status,
    from,
    to,
    sort: sortField
      ? `${sortField.desc ? '-' : ''}${sortField.id === 'date' ? config.date : sortField.id}`
      : defaultSort,
  };
  const invalidRange = !!(from && to && from > to);
  const query = usePurchaseList(
    kind,
    { ...filters, page: list.page, limit: list.pageSize },
    !invalidRange && prefs.isReady,
  );
  const rows = query.data?.data ?? EMPTY;
  const clearAdvanced = () => {
    list.setFilter('supplierId', '');
    list.setFilter('from', '');
    list.setFilter('to', '');
    list.setFilter('status', '');
    setSupplierName('');
    setFilterSupplier(false);
  };
  return (
    <div className="page">
      <PageHeader
        title={config.title}
        description="Quản lý chứng từ tại chi nhánh đang làm việc."
        actions={
          edit && (
            <Button onClick={() => setForm({ kind })}>
              <Plus aria-hidden="true" />
              Tạo phiếu
            </Button>
          )
        }
      />
      <TableToolbar>
        <TableSearch
          value={list.q}
          onChange={list.setQ}
          placeholder="Tìm mã phiếu hoặc nhà cung cấp"
          label="Tìm chứng từ"
        />
        <FilterSelect
          label="Trạng thái phiếu"
          value={list.filters.status}
          onChange={(v) => list.setFilter('status', v)}
          options={[
            { value: '', label: 'Mọi trạng thái' },
            ...Object.entries(PURCHASE_STATUS)
              .filter(
                ([value]) => kind === 'orders' || value === 'completed' || value === 'cancelled',
              )
              .map(([value, label]) => ({ value, label })),
          ]}
        />
        <Button variant="outline" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
          <Filter aria-hidden="true" />
          Bộ lọc{from || to || list.filters.supplierId ? ' · Đang áp dụng' : ''}
        </Button>
        <ToolbarEnd>
          {!invalidRange && query.data && <ToolbarCount total={query.data.meta.total} />}
          <ColumnPicker prefs={prefs} />
          <ExportExcelButton
            exporting={exporting}
            disabled={invalidRange || !query.data?.meta.total}
            onExport={async () => {
              setExporting(true);
              try {
                const file = await api.download(config.path, {
                  query: { ...filters, format: 'xlsx' },
                });
                saveBlob(file.blob, file.filename ?? 'mua-hang.xlsx');
              } catch (err) {
                toast.error(errorMessage(err));
              } finally {
                setExporting(false);
              }
            }}
          />
        </ToolbarEnd>
      </TableToolbar>
      {advanced && (
        <div className="purchase-filters purchase-filter-panel">
          <label>
            Từ ngày
            <Input
              type="date"
              value={from}
              onChange={(e) => list.setFilter('from', e.target.value)}
            />
          </label>
          <label>
            Đến ngày
            <Input
              type="date"
              min={from}
              value={to}
              onChange={(e) => list.setFilter('to', e.target.value)}
            />
          </label>
          <Button variant="outline" onClick={() => setFilterSupplier(!filterSupplier)}>
            {list.filters.supplierId ? supplierName : 'Chọn nhà cung cấp'}
          </Button>
          <Button variant="ghost" onClick={clearAdvanced}>
            <X aria-hidden="true" />
            Xóa bộ lọc
          </Button>
        </div>
      )}
      {filterSupplier && (
        <SupplierPicker
          value={
            list.filters.supplierId ? { id: list.filters.supplierId, name: supplierName } : null
          }
          onChange={(s) => {
            list.setFilter('supplierId', s?.id ?? '');
            setSupplierName(s?.name ?? '');
            setFilterSupplier(false);
          }}
        />
      )}
      {invalidRange ? (
        <p className="alert alert-error" role="alert">
          Ngày kết thúc phải từ ngày bắt đầu trở đi.
        </p>
      ) : query.isError ? (
        <QueryError error={query.error} retry={query.refetch} />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={rows}
            isLoading={query.isLoading || !prefs.isReady}
            getRowId={(d) => d.id}
            onRowClick={(d) => setDetail({ kind, id: d.id })}
            prefs={prefs}
            sort={list.sort}
            onSortChange={list.onSortChange}
            emptyText="Không có chứng từ phù hợp"
          />
          <Pagination
            meta={query.data?.meta}
            onPageChange={list.setPage}
            pageSize={list.pageSize}
            onPageSizeChange={list.onPageSizeChange}
          />
        </>
      )}
      {detail && !form && (
        <PurchaseDetail
          key={`${detail.kind}-${detail.id}`}
          {...detail}
          onClose={() => setDetail(null)}
          onForm={setForm}
          onNavigate={(nextKind, id) => setDetail({ kind: nextKind, id })}
        />
      )}
      {form && (
        <PurchaseForm
          target={form}
          onClose={() => setForm(null)}
          onSaved={(doc) => {
            setDetail({ kind: form.kind, id: doc.id });
            setForm(null);
          }}
        />
      )}
    </div>
  );
}
