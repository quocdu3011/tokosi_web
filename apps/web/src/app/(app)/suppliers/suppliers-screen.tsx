'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable, type AppColumnDef } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { RequirePermission } from '@/components/common/require-permission';
import { QueryError } from '@/components/purchasing/query-feedback';
import { api, errorMessage } from '@/lib/api';
import type { Supplier } from '@/lib/api/types';
import { useAuthStore } from '@/lib/auth/store';
import { useBranchStore } from '@/lib/branch';
import { can } from '@/lib/permissions';
import { formatMoney } from '@/lib/format';
import { saveBlob } from '@/lib/table-export';
import { useSupplierList, useSaveSupplier } from '@/lib/queries/suppliers';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useColumnVisibility } from '@/hooks/use-column-visibility';
import { PageHeader } from '@/components/common/coming-soon';
import { FilterSelect, PurchaseToolbar } from '@/components/purchasing/purchase-ui';
import { SupplierForm } from './supplier-form';
import { SupplierDetail } from './supplier-detail';

const DEFAULT_HIDDEN = ['group', 'net'];
const WIDTHS = {
  code: 140,
  name: 280,
  group: 160,
  total: 170,
  net: 180,
  debt: 170,
  status: 160,
  actions: 160,
};

export function SuppliersScreen() {
  const branchId = useBranchStore((s) => s.branchId);
  return (
    <RequirePermission anyOf={['purchase.view']}>
      <SupplierWorkspace key={branchId} />
    </RequirePermission>
  );
}
function SupplierWorkspace() {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const [active, setActive] = useState('');
  const [hasDebt, setHasDebt] = useState('');
  const [sort, setSort] = useState('code');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [toggle, setToggle] = useState<Supplier | null>(null);
  const [exporting, setExporting] = useState(false);
  const me = useAuthStore((s) => s.user);
  const edit = can(me, 'purchase.edit');
  const debt = can(me, 'debt.view');
  const term = useDebouncedValue(q, 250);
  const groupTerm = useDebouncedValue(group, 250);
  const filters = {
    q: term,
    groupName: groupTerm,
    isActive: active ? active === 'true' : undefined,
    hasDebt: debt && hasDebt ? hasDebt === 'true' : undefined,
    sort,
  };
  const query = useSupplierList({ ...filters, page, limit: 20 });
  const save = useSaveSupplier();
  const { hidden, setVisible, reset } = useColumnVisibility(
    'table:suppliers:hidden',
    DEFAULT_HIDDEN,
  );
  const columns: AppColumnDef<Supplier>[] = [
    {
      id: 'code',
      header: 'Mã NCC',
      cell: ({ row }) => (
        <Button variant="link" onClick={() => setDetail(row.original.id)}>
          {row.original.code}
        </Button>
      ),
    },
    { id: 'name', header: 'Nhà cung cấp', accessorKey: 'name' },
    { id: 'group', header: 'Nhóm', cell: ({ row }) => row.original.groupName ?? '—' },
    {
      id: 'total',
      header: 'Tổng mua',
      cell: ({ row }) => <span className="num">{formatMoney(row.original.totalPurchase)}</span>,
    },
    {
      id: 'net',
      header: 'Mua trừ trả hàng',
      cell: ({ row }) => <span className="num">{formatMoney(row.original.netPurchase)}</span>,
    },
    ...(debt
      ? [
          {
            id: 'debt',
            header: 'Nợ cần trả',
            cell: ({ row }: { row: { original: Supplier } }) => (
              <span className="num">{formatMoney(row.original.balance)}</span>
            ),
          },
        ]
      : []),
    {
      id: 'status',
      header: 'Trạng thái',
      cell: ({ row }) => (
        <span className={`badge badge-${row.original.isActive ? 'success' : 'neutral'}`}>
          {row.original.isActive ? 'Đang giao dịch' : 'Ngưng giao dịch'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) =>
        edit && (
          <div className="cell-actions">
            <Button variant="outline" size="sm" onClick={() => setEditing(row.original)}>
              Sửa
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setToggle(row.original)}>
              {row.original.isActive ? 'Ngưng' : 'Mở lại'}
            </Button>
          </div>
        ),
    },
  ];
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
      <PurchaseToolbar
        search={q}
        setSearch={(value) => {
          setQ(value);
          setPage(1);
        }}
        placeholder="Tìm mã hoặc tên nhà cung cấp"
        total={query.data?.meta.total}
        columns={columns
          .filter((c) => c.id !== 'actions' && c.id !== 'code' && c.id !== 'name')
          .map((c) => ({ id: c.id!, label: String(c.header) }))}
        hidden={hidden}
        onToggle={setVisible}
        onReset={reset}
        exporting={exporting}
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
      >
        <FilterSelect
          label="Trạng thái giao dịch"
          value={active}
          onChange={(v) => {
            setActive(v);
            setPage(1);
          }}
          options={[
            { value: '', label: 'Mọi trạng thái' },
            { value: 'true', label: 'Đang giao dịch' },
            { value: 'false', label: 'Ngưng giao dịch' },
          ]}
        />
        {debt && (
          <FilterSelect
            label="Lọc công nợ"
            value={hasDebt}
            onChange={(v) => {
              setHasDebt(v);
              setPage(1);
            }}
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
          value={group}
          onChange={(e) => {
            setGroup(e.target.value);
            setPage(1);
          }}
        />
      </PurchaseToolbar>
      {query.isError ? (
        <QueryError error={query.error} retry={query.refetch} />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={query.data?.data ?? []}
            isLoading={query.isLoading}
            getRowId={(s) => s.id}
            onRowClick={(s) => setDetail(s.id)}
            hiddenColumns={hidden}
            sort={sort ? { id: sort.replace(/^-/, ''), desc: sort.startsWith('-') } : null}
            onSortChange={(s) => {
              setSort(s ? `${s.desc ? '-' : ''}${s.id}` : 'code');
              setPage(1);
            }}
            sortableIds={['code', 'name']}
            resizable={{ storageKey: 'table:suppliers', defaultWidths: WIDTHS }}
            emptyText="Không có nhà cung cấp phù hợp"
          />
          <Pagination meta={query.data?.meta} onPageChange={setPage} />
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
