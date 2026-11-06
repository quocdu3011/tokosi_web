'use client';
import { useState } from 'react';
import { Plus, Filter, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable, type AppColumnDef } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
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
  RECEIVE_STATUS,
  type PurchaseKind,
} from '@/lib/purchasing';
import { usePurchaseList } from '@/lib/queries/purchasing';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useColumnVisibility } from '@/hooks/use-column-visibility';
import { PageHeader } from '@/components/common/coming-soon';
import { FilterSelect, PurchaseStatus, PurchaseToolbar } from './purchase-ui';
import { PurchaseDetail } from './purchase-detail';
import { PurchaseForm, type PurchaseFormTarget } from './purchase-form';
import { SupplierPicker } from './supplier-picker';
import { QueryError } from './query-feedback';

const DEFAULT_HIDDEN = ['qty', 'note'];
const WIDTHS = {
  code: 145,
  date: 180,
  supplier: 290,
  qty: 145,
  total: 180,
  status: 180,
  receive: 170,
  note: 260,
};

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
  const [q, setQ] = useState('');
  const term = useDebouncedValue(q, 250);
  const [supplier, setSupplier] = useState<{ id: string; name: string } | null>(null);
  const [filterSupplier, setFilterSupplier] = useState(false);
  const [status, setStatus] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState(`-${config.date}`);
  const [detail, setDetail] = useState<{ kind: PurchaseKind; id: string } | null>(null);
  const [form, setForm] = useState<PurchaseFormTarget | null>(null);
  const [exporting, setExporting] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const { hidden, setVisible, reset } = useColumnVisibility(
    `table:purchase-${kind}:hidden`,
    DEFAULT_HIDDEN,
  );
  const me = useAuthStore((s) => s.user);
  const edit = can(me, 'purchase.edit');
  const filters = { q: term, supplierId: supplier?.id, status, ...range, sort };
  const invalidRange = !!(range.from && range.to && range.from > range.to);
  const query = usePurchaseList(kind, { ...filters, page, limit: 20 }, !invalidRange);
  const columns: AppColumnDef<PurchaseDocument>[] = [
    {
      id: 'code',
      header: 'Mã phiếu',
      cell: ({ row }) => (
        <Button variant="link" onClick={() => setDetail({ kind, id: row.original.id })}>
          {row.original.code}
        </Button>
      ),
    },
    {
      id: 'date',
      header: 'Ngày chứng từ',
      cell: ({ row }) => formatDateTime(documentDate(row.original)),
    },
    { id: 'supplier', header: 'Nhà cung cấp', cell: ({ row }) => row.original.supplier.name },
    {
      id: 'qty',
      header: 'Tổng số lượng',
      cell: ({ row }) => <span className="num">{formatDecimal(row.original.totalQty)}</span>,
    },
    {
      id: 'total',
      header: 'Tổng tiền',
      cell: ({ row }) => <span className="num">{formatMoney(row.original.total)}</span>,
    },
    {
      id: 'status',
      header: 'Trạng thái',
      cell: ({ row }) => <PurchaseStatus status={row.original.status} />,
    },
    ...(kind === 'orders'
      ? [
          {
            id: 'receive',
            header: 'Tình trạng nhập',
            cell: ({ row }: { row: { original: PurchaseDocument } }) =>
              'receiveState' in row.original ? RECEIVE_STATUS[row.original.receiveState] : '',
          },
        ]
      : []),
    { id: 'note', header: 'Ghi chú', cell: ({ row }) => row.original.note ?? '—' },
  ];
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
      <PurchaseToolbar
        search={q}
        setSearch={(value) => {
          setQ(value);
          setPage(1);
        }}
        placeholder="Tìm mã phiếu hoặc nhà cung cấp"
        total={invalidRange ? undefined : query.data?.meta.total}
        columns={columns
          .filter((c) => c.id !== 'code' && c.id !== 'supplier')
          .map((c) => ({ id: c.id!, label: String(c.header) }))}
        hidden={hidden}
        onToggle={setVisible}
        onReset={reset}
        exporting={exporting}
        onExport={async () => {
          setExporting(true);
          try {
            const file = await api.download(config.path, { query: { ...filters, format: 'xlsx' } });
            saveBlob(file.blob, file.filename ?? 'mua-hang.xlsx');
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setExporting(false);
          }
        }}
      >
        <FilterSelect
          label="Trạng thái phiếu"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
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
          Bộ lọc{range.from || range.to || supplier ? ' · Đang áp dụng' : ''}
        </Button>
      </PurchaseToolbar>
      {advanced && (
        <div className="purchase-filters purchase-filter-panel">
          <label>
            Từ ngày
            <Input
              type="date"
              value={range.from}
              onChange={(e) => {
                setRange({ ...range, from: e.target.value });
                setPage(1);
              }}
            />
          </label>
          <label>
            Đến ngày
            <Input
              type="date"
              min={range.from}
              value={range.to}
              onChange={(e) => {
                setRange({ ...range, to: e.target.value });
                setPage(1);
              }}
            />
          </label>
          <Button variant="outline" onClick={() => setFilterSupplier(!filterSupplier)}>
            {supplier ? supplier.name : 'Chọn nhà cung cấp'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setSupplier(null);
              setRange({ from: '', to: '' });
              setStatus('');
              setPage(1);
              setFilterSupplier(false);
            }}
          >
            <X aria-hidden="true" />
            Xóa bộ lọc
          </Button>
        </div>
      )}
      {filterSupplier && (
        <SupplierPicker
          value={supplier}
          onChange={(s) => {
            setSupplier(s);
            setPage(1);
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
            data={query.data?.data ?? []}
            isLoading={query.isLoading}
            getRowId={(d) => d.id}
            onRowClick={(d) => setDetail({ kind, id: d.id })}
            hiddenColumns={hidden}
            sort={{
              id: sort.replace(/^-/, '') === config.date ? 'date' : sort.replace(/^-/, ''),
              desc: sort.startsWith('-'),
            }}
            onSortChange={(s) => {
              setSort(
                s
                  ? `${s.desc ? '-' : ''}${s.id === 'date' ? config.date : s.id}`
                  : `-${config.date}`,
              );
              setPage(1);
            }}
            sortableIds={['code', 'date', 'total']}
            resizable={{ storageKey: `table:purchase-${kind}`, defaultWidths: WIDTHS }}
            emptyText="Không có chứng từ phù hợp"
          />
          <Pagination meta={query.data?.meta} onPageChange={setPage} />
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
