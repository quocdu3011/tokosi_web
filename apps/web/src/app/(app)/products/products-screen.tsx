'use client';

import { Plus } from 'lucide-react';
import {
  LIQUIDATION_STATUSES,
  LIQUIDATION_STATUS_LABELS,
  PRODUCT_EXPORT_COLUMNS,
  isProductCostColumn,
  type ProductExportColumnId,
} from '@kiot/shared';
import { useMemo, useState } from 'react';

import { PageHeader } from '@/components/common/coming-soon';
import { ACTIVE_STATUS_TONES, StatusBadge } from '@/components/common/status-badge';
import { sortableIdsOf } from '@/components/data-table/column-meta';
import { DataTable, type AppColumnDef } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import {
  ColumnPicker,
  ExportMenu,
  FilterSelect,
  ImportButton,
  TableSearch,
  TableToolbar,
  ToolbarCount,
  ToolbarEnd,
} from '@/components/data-table/table-toolbar';
import { ImportDialog } from '@/components/import/import-dialog';
import { Button } from '@/components/ui/button';
import { useListState } from '@/hooks/use-list-state';
import { useTablePrefs } from '@/hooks/use-table-prefs';
import { errorMessage } from '@/lib/api';
import type { Product } from '@/lib/api/types';
import { useAuthStore } from '@/lib/auth/store';
import { formatDateTime, formatDecimal, formatMoney } from '@/lib/format';
import { can } from '@/lib/permissions';
import {
  downloadProductsXlsx,
  useProductList,
  type ProductFilterParams,
} from '@/lib/queries/products';
import { exportFilename, saveBlob } from '@/lib/table-export';
import { decimalSortValue, sortRows, type SortValue } from '@/lib/table-sort';

import { ProductDrawer, type DrawerTarget } from './product-drawer';

const TABLE_KEY = 'products';
/** Chuỗi rỗng = mọi giá trị (không lọc). Mặc định chỉ hiện hàng đang kinh doanh. */
const INITIAL_FILTERS = { status: 'active', stock: '', productType: '', liquidation: '' };
const EMPTY: Product[] = [];

/** Cột `sort: 'page'`: API chưa sắp xếp được → so sánh ngay trên các dòng của trang đang xem. */
const PAGE_SORT: Record<string, (p: Product) => SortValue> = {
  costPrice: (p) => decimalSortValue(p.costPrice),
  reserved: (p) => decimalSortValue(p.reserved),
  available: (p) => decimalSortValue(p.available),
  onOrder: (p) => decimalSortValue(p.onOrder),
  lastPurchasePrice: (p) => decimalSortValue(p.lastPurchasePrice),
  status: (p) => (p.isActive ? 0 : 1),
};

/** Danh sách hàng hóa theo chi nhánh làm việc (tồn kho, giá vốn riêng từng chi nhánh). */
export function ProductsScreen() {
  const me = useAuthStore((s) => s.user);
  const canSeeCost = can(me, 'product.cost.view');
  const canImport = can(me, 'import.run');
  const canEdit = can(me, 'product.edit');
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const columns = useMemo<AppColumnDef<Product>[]>(() => {
    const cols: AppColumnDef<Product>[] = [
      {
        id: 'code',
        header: 'Mã hàng',
        meta: { label: 'Mã hàng', width: 120, locked: true, sort: 'server' },
        cell: ({ row }) => (
          <button
            type="button"
            className="link-button tabular"
            onClick={() => setDrawer({ kind: 'view', id: row.original.id })}
            aria-label={`Xem hàng ${row.original.code}`}
          >
            {row.original.code}
          </button>
        ),
      },
      {
        id: 'name',
        header: 'Tên hàng',
        meta: { label: 'Tên hàng', width: 320, locked: true, sort: 'server' },
        cell: ({ row }) => (
          <div className="cell-stack">
            <span className="cell-title">{row.original.name}</span>
          </div>
        ),
      },
    ];
    // Giá vốn chỉ có khi đủ quyền `product.cost.view` (field vắng mặt hoàn toàn nếu thiếu quyền).
    if (canSeeCost) {
      cols.push(
        {
          id: 'costPrice',
          header: () => <span className="num">Giá vốn</span>,
          meta: { label: 'Giá vốn', width: 140, sort: 'page' },
          cell: ({ row }) => (
            <span className="num">
              {row.original.costPrice === undefined ? '' : formatMoney(row.original.costPrice)}
            </span>
          ),
        },
        {
          id: 'lastPurchasePrice',
          header: () => <span className="num">Giá nhập cuối</span>,
          meta: { label: 'Giá nhập cuối', width: 150, hiddenByDefault: true, sort: 'page' },
          cell: ({ row }) => (
            <span className="num">
              {row.original.lastPurchasePrice === undefined
                ? ''
                : formatMoney(row.original.lastPurchasePrice)}
            </span>
          ),
        },
      );
    }
    cols.push(
      {
        id: 'onHand',
        header: () => <span className="num">Tồn kho</span>,
        meta: { label: 'Tồn kho', width: 110, sort: 'server' },
        cell: ({ row }) => <span className="num">{formatDecimal(row.original.onHand) || '0'}</span>,
      },
      {
        id: 'reserved',
        header: () => <span className="num">Khách đặt</span>,
        meta: { label: 'Khách đặt', width: 110, sort: 'page' },
        cell: ({ row }) => (
          <span className="num">{formatDecimal(row.original.reserved) || '0'}</span>
        ),
      },
      {
        id: 'available',
        header: () => <span className="num">Có thể bán</span>,
        meta: { label: 'Có thể bán', width: 120, sort: 'page' },
        cell: ({ row }) => (
          <span className="num">{formatDecimal(row.original.available) || '0'}</span>
        ),
      },
      {
        id: 'productType',
        header: 'Loại hàng',
        meta: { label: 'Loại hàng', width: 120, hiddenByDefault: true },
        cell: ({ row }) =>
          row.original.productType === 'combo' ? (
            <StatusBadge tone="info">Combo</StatusBadge>
          ) : (
            <span>Hàng hóa</span>
          ),
      },
      {
        id: 'liquidation',
        header: 'Thanh lý',
        meta: { label: 'Thanh lý', width: 140, hiddenByDefault: true },
        cell: ({ row }) =>
          LIQUIDATION_STATUS_LABELS[
            row.original.liquidationStatus as keyof typeof LIQUIDATION_STATUS_LABELS
          ] ?? '',
      },
      {
        id: 'onOrder',
        header: () => <span className="num">Đang đặt NCC</span>,
        meta: { label: 'Đang đặt NCC', width: 120, hiddenByDefault: true, sort: 'page' },
        cell: ({ row }) => (
          <span className="num">{formatDecimal(row.original.onOrder) || '0'}</span>
        ),
      },
      {
        id: 'createdAt',
        header: 'Thời gian tạo',
        meta: { label: 'Thời gian tạo', width: 170, hiddenByDefault: true },
        cell: ({ row }) => (
          <span className="tabular">{formatDateTime(row.original.createdAt)}</span>
        ),
      },
      {
        id: 'description',
        header: 'Mô tả',
        meta: { label: 'Mô tả', width: 280, hiddenByDefault: true },
        cell: ({ row }) => <span className="cell-sub">{row.original.description ?? ''}</span>,
      },
      {
        id: 'status',
        header: 'Trạng thái',
        meta: { label: 'Trạng thái', width: 210, sort: 'page' },
        cell: ({ row }) => (
          <StatusBadge tone={ACTIVE_STATUS_TONES[row.original.isActive ? 'active' : 'inactive']}>
            {row.original.isActive ? 'Đang kinh doanh' : 'Ngừng kinh doanh'}
          </StatusBadge>
        ),
      },
    );
    return cols;
  }, [canSeeCost]);

  const prefs = useTablePrefs(TABLE_KEY, columns);
  const list = useListState({ initialFilters: INITIAL_FILTERS, prefs });
  const { status, stock, productType, liquidation } = list.filters;

  // Bộ lọc + sắp xếp dùng chung cho danh sách, xuất Excel (file luôn khớp màn hình).
  const serverIds = sortableIdsOf(columns, 'server');
  const filters: ProductFilterParams = {
    q: list.debouncedQ || undefined,
    isActive: status === '' ? undefined : status === 'active',
    inStock: stock === 'in' ? true : undefined,
    productType: productType === '' ? undefined : (productType as Product['productType']),
    liquidationStatus:
      liquidation === '' ? undefined : (liquidation as Product['liquidationStatus']),
    sort:
      list.sort && serverIds.includes(list.sort.id)
        ? `${list.sort.desc ? '-' : ''}${list.sort.id}`
        : undefined,
  };
  const { data, isLoading, isError, error } = useProductList(
    { ...filters, page: list.page, limit: list.pageSize },
    { enabled: prefs.isReady },
  );
  // Cột `page`: API chưa hỗ trợ → sắp xếp ngay trên các dòng của trang hiện tại.
  const rows = useMemo(
    () => sortRows(data?.data ?? EMPTY, list.sort, PAGE_SORT),
    [data, list.sort],
  );

  const exportOptions = PRODUCT_EXPORT_COLUMNS.filter(
    (column) => canSeeCost || !isProductCostColumn(column.id),
  );

  const handleExport = async (selectedColumns: ProductExportColumnId[]) => {
    const { blob, filename } = await downloadProductsXlsx(filters, selectedColumns);
    saveBlob(blob, filename ?? exportFilename('hang-hoa', 'xlsx'));
  };

  return (
    <div className="page">
      <PageHeader
        title="Danh sách hàng hóa"
        description="Tồn kho và giá vốn hiển thị theo chi nhánh đang làm việc. Hệ thống không lưu giá bán."
        actions={
          canEdit ? (
            <Button onClick={() => setDrawer({ kind: 'create' })}>
              <Plus aria-hidden="true" /> Thêm hàng hóa
            </Button>
          ) : undefined
        }
      />

      <TableToolbar>
        <TableSearch
          value={list.q}
          onChange={list.setQ}
          placeholder="Tìm mã hoặc tên hàng"
          label="Tìm hàng hóa"
        />
        <FilterSelect
          label="Lọc theo trạng thái"
          value={status as string}
          onChange={(v) => list.setFilter('status', v)}
          options={[
            { value: '', label: 'Mọi trạng thái' },
            { value: 'active', label: 'Đang kinh doanh' },
            { value: 'inactive', label: 'Ngừng kinh doanh' },
          ]}
        />
        <FilterSelect
          label="Lọc theo tồn kho"
          value={stock}
          onChange={(v) => list.setFilter('stock', v)}
          options={[
            { value: '', label: 'Mọi tồn kho' },
            { value: 'in', label: 'Còn hàng' },
          ]}
        />
        <FilterSelect
          label="Lọc theo loại hàng"
          value={productType}
          onChange={(v) => list.setFilter('productType', v)}
          options={[
            { value: '', label: 'Mọi loại hàng' },
            { value: 'goods', label: 'Hàng hóa' },
            { value: 'combo', label: 'Combo' },
          ]}
        />
        <FilterSelect
          label="Lọc theo thanh lý"
          value={liquidation}
          onChange={(v) => list.setFilter('liquidation', v)}
          options={[
            { value: '', label: 'Mọi trạng thái thanh lý' },
            ...LIQUIDATION_STATUSES.map((value) => ({
              value,
              label: LIQUIDATION_STATUS_LABELS[value],
            })),
          ]}
        />
        <ToolbarEnd>
          {data && <ToolbarCount total={data.meta.total} />}
          <ColumnPicker prefs={prefs} />
          {canImport && <ImportButton onClick={() => setImportOpen(true)} />}
          <ExportMenu
            options={exportOptions}
            onExport={handleExport}
            disabled={!data || data.meta.total === 0}
          />
        </ToolbarEnd>
      </TableToolbar>
      {importOpen && <ImportDialog type="products" onClose={() => setImportOpen(false)} />}
      {drawer && <ProductDrawer target={drawer} onClose={() => setDrawer(null)} />}

      {isError ? (
        <p className="alert alert-error" role="alert">
          {errorMessage(error)}
        </p>
      ) : (
        <>
          <DataTable
            columns={columns}
            data={rows}
            isLoading={isLoading || !prefs.isReady}
            emptyText="Không có hàng hóa phù hợp"
            getRowId={(p) => p.id}
            prefs={prefs}
            sort={list.sort}
            onSortChange={list.onSortChange}
            onRowClick={(p) => setDrawer({ kind: 'view', id: p.id })}
          />
          <Pagination
            meta={data?.meta}
            onPageChange={list.setPage}
            pageSize={list.pageSize}
            onPageSizeChange={list.onPageSizeChange}
          />
        </>
      )}
    </div>
  );
}
