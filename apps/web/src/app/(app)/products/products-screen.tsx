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
import { DataTable, type AppColumnDef, type SortState } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import {
  ColumnPicker,
  ExportMenu,
  ImportButton,
  TableSearch,
} from '@/components/data-table/table-toolbar';
import { ImportDialog } from '@/components/import/import-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useColumnVisibility } from '@/hooks/use-column-visibility';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
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

const ALL = 'all';
const PAGE_SIZE = 20;

/** Cột server sắp xếp được trên TOÀN BỘ kết quả (endpoints.md mục 2.1: `code`, `name`, `onHand`, `createdAt`). */
const SERVER_SORT_IDS: readonly string[] = ['code', 'name', 'onHand'];

/** Các cột còn lại API chưa hỗ trợ `sort` → chỉ sắp xếp được trong trang đang xem. */
const PAGE_SORT: Record<string, (p: Product) => SortValue> = {
  costPrice: (p) => decimalSortValue(p.costPrice),
  reserved: (p) => decimalSortValue(p.reserved),
  available: (p) => decimalSortValue(p.available),
  onOrder: (p) => decimalSortValue(p.onOrder),
  lastPurchasePrice: (p) => decimalSortValue(p.lastPurchasePrice),
  status: (p) => (p.isActive ? 0 : 1),
};
const SORTABLE_IDS: readonly string[] = [...SERVER_SORT_IDS, ...Object.keys(PAGE_SORT)];
const SORT_HINTS: Record<string, string> = Object.fromEntries(
  Object.keys(PAGE_SORT).map((id) => [id, 'Sắp xếp trong trang đang xem']),
);

/** Độ rộng mặc định (px) từng cột; người dùng kéo mép tiêu đề để đổi, được nhớ theo trình duyệt. */
const DEFAULT_WIDTHS = {
  code: 120,
  name: 320,
  costPrice: 140,
  onHand: 110,
  reserved: 110,
  available: 120,
  status: 210,
  productType: 120,
  liquidation: 140,
  lastPurchasePrice: 150,
  onOrder: 120,
  createdAt: 170,
  description: 280,
};
/** Cột phụ: mặc định ẩn, bật ở nút "Cột" (dữ liệu API đã trả sẵn). */
const DEFAULT_HIDDEN: readonly string[] = [
  'productType',
  'liquidation',
  'lastPurchasePrice',
  'onOrder',
  'createdAt',
  'description',
];
/** Tên cột hiển thị trong hộp "Cột". */
const PICKER_LABELS: Record<string, string> = {
  costPrice: 'Giá vốn',
  onHand: 'Tồn kho',
  reserved: 'Khách đặt',
  available: 'Có thể bán',
  status: 'Trạng thái',
  productType: 'Loại hàng',
  liquidation: 'Thanh lý',
  lastPurchasePrice: 'Giá nhập cuối',
  onOrder: 'Đang đặt NCC',
  createdAt: 'Thời gian tạo',
  description: 'Mô tả',
};
const COLUMN_LABELS: Record<string, string> = {
  code: 'mã hàng',
  name: 'tên hàng',
  costPrice: 'giá vốn',
  onHand: 'tồn kho',
  reserved: 'khách đặt',
  available: 'có thể bán',
  status: 'trạng thái',
  productType: 'loại hàng',
  liquidation: 'thanh lý',
  lastPurchasePrice: 'giá nhập cuối',
  onOrder: 'đang đặt NCC',
  createdAt: 'thời gian tạo',
  description: 'mô tả',
};

/** Danh sách hàng hóa theo chi nhánh làm việc (tồn kho, giá vốn riêng từng chi nhánh). */
export function ProductsScreen() {
  const me = useAuthStore((s) => s.user);
  const canSeeCost = can(me, 'product.cost.view');
  const canImport = can(me, 'import.run');
  const canEdit = can(me, 'product.edit');
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const { hidden, setVisible, reset } = useColumnVisibility('cols:products', DEFAULT_HIDDEN);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('active');
  const [stock, setStock] = useState<string>(ALL);
  const [productType, setProductType] = useState<string>(ALL);
  const [liquidationStatus, setLiquidationStatus] = useState<string>(ALL);
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);
  const debouncedQ = useDebouncedValue(q.trim());

  // Bộ lọc + sắp xếp dùng chung cho danh sách, xuất Excel (file luôn khớp màn hình).
  const filters: ProductFilterParams = {
    q: debouncedQ || undefined,
    isActive: status === ALL ? undefined : status === 'active',
    inStock: stock === 'in' ? true : undefined,
    productType: productType === ALL ? undefined : (productType as Product['productType']),
    liquidationStatus:
      liquidationStatus === ALL ? undefined : (liquidationStatus as Product['liquidationStatus']),
    sort:
      sort && SERVER_SORT_IDS.includes(sort.id) ? `${sort.desc ? '-' : ''}${sort.id}` : undefined,
  };
  const { data, isLoading, isError, error } = useProductList({
    ...filters,
    page,
    limit: PAGE_SIZE,
  });
  // Cột không có ở API: sắp xếp ngay trên các dòng của trang hiện tại.
  const rows = useMemo(() => sortRows(data?.data ?? EMPTY, sort, PAGE_SORT), [data, sort]);

  const columns = useMemo<AppColumnDef<Product>[]>(() => {
    const cols: AppColumnDef<Product>[] = [
      {
        id: 'code',
        header: 'Mã hàng',
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
        cell: ({ row }) => (
          <div className="cell-stack">
            <span className="cell-title">{row.original.name}</span>
          </div>
        ),
      },
    ];
    // Giá vốn chỉ có khi đủ quyền `product.cost.view` (field vắng mặt hoàn toàn nếu thiếu quyền).
    if (canSeeCost) {
      cols.push({
        id: 'costPrice',
        header: () => <span className="num">Giá vốn</span>,
        cell: ({ row }) => (
          <span className="num">
            {row.original.costPrice === undefined ? '' : formatMoney(row.original.costPrice)}
          </span>
        ),
      });
      cols.push({
        id: 'lastPurchasePrice',
        header: () => <span className="num">Giá nhập cuối</span>,
        cell: ({ row }) => (
          <span className="num">
            {row.original.lastPurchasePrice === undefined
              ? ''
              : formatMoney(row.original.lastPurchasePrice)}
          </span>
        ),
      });
    }
    cols.push(
      {
        id: 'onHand',
        header: () => <span className="num">Tồn kho</span>,
        cell: ({ row }) => <span className="num">{formatDecimal(row.original.onHand) || '0'}</span>,
      },
      {
        id: 'reserved',
        header: () => <span className="num">Khách đặt</span>,
        cell: ({ row }) => (
          <span className="num">{formatDecimal(row.original.reserved) || '0'}</span>
        ),
      },
      {
        id: 'available',
        header: () => <span className="num">Có thể bán</span>,
        cell: ({ row }) => (
          <span className="num">{formatDecimal(row.original.available) || '0'}</span>
        ),
      },
      {
        id: 'productType',
        header: 'Loại hàng',
        cell: ({ row }) =>
          row.original.productType === 'combo' ? (
            <Badge variant="info">Combo</Badge>
          ) : (
            <span>Hàng hóa</span>
          ),
      },
      {
        id: 'liquidation',
        header: 'Thanh lý',
        cell: ({ row }) =>
          LIQUIDATION_STATUS_LABELS[
            row.original.liquidationStatus as keyof typeof LIQUIDATION_STATUS_LABELS
          ] ?? '',
      },
      {
        id: 'onOrder',
        header: () => <span className="num">Đang đặt NCC</span>,
        cell: ({ row }) => (
          <span className="num">{formatDecimal(row.original.onOrder) || '0'}</span>
        ),
      },
      {
        id: 'createdAt',
        header: 'Thời gian tạo',
        cell: ({ row }) => (
          <span className="tabular">{formatDateTime(row.original.createdAt)}</span>
        ),
      },
      {
        id: 'description',
        header: 'Mô tả',
        cell: ({ row }) => <span className="cell-sub">{row.original.description ?? ''}</span>,
      },
      {
        id: 'status',
        header: 'Trạng thái',
        cell: ({ row }) => (
          <div className="cell-badges">
            {row.original.isActive ? (
              <Badge variant="success">Đang kinh doanh</Badge>
            ) : (
              <Badge variant="destructive">Ngừng kinh doanh</Badge>
            )}
          </div>
        ),
      },
    );
    return cols;
  }, [canSeeCost]);

  /** Cột cho phép ẩn/hiện, theo thứ tự trên bảng (Mã hàng, Tên hàng và Thao tác luôn hiện). */
  const columnOptions = useMemo(
    () =>
      columns
        .map((c) => c.id ?? '')
        .filter((id) => id !== 'code' && id !== 'name' && id !== 'actions')
        .map((id) => ({ id, label: PICKER_LABELS[id] ?? id })),
    [columns],
  );

  const resetFilters = (fn: () => void) => {
    fn();
    setPage(1);
  };

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

      <div className="toolbar">
        <TableSearch
          value={q}
          onChange={(v) => resetFilters(() => setQ(v))}
          placeholder="Tìm mã hoặc tên hàng"
          label="Tìm hàng hóa"
        />
        <Select value={status} onValueChange={(v) => resetFilters(() => setStatus(v))}>
          <SelectTrigger aria-label="Lọc theo trạng thái" className="toolbar-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Mọi trạng thái</SelectItem>
            <SelectItem value="active">Đang kinh doanh</SelectItem>
            <SelectItem value="inactive">Ngừng kinh doanh</SelectItem>
          </SelectContent>
        </Select>
        <Select value={stock} onValueChange={(v) => resetFilters(() => setStock(v))}>
          <SelectTrigger aria-label="Lọc theo tồn kho" className="toolbar-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Mọi tồn kho</SelectItem>
            <SelectItem value="in">Còn hàng</SelectItem>
          </SelectContent>
        </Select>
        <Select value={productType} onValueChange={(v) => resetFilters(() => setProductType(v))}>
          <SelectTrigger aria-label="Lọc theo loại hàng" className="toolbar-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Mọi loại hàng</SelectItem>
            <SelectItem value="goods">Hàng hóa</SelectItem>
            <SelectItem value="combo">Combo</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={liquidationStatus}
          onValueChange={(v) => resetFilters(() => setLiquidationStatus(v))}
        >
          <SelectTrigger aria-label="Lọc theo thanh lý" className="toolbar-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Mọi trạng thái thanh lý</SelectItem>
            {LIQUIDATION_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {LIQUIDATION_STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="toolbar-end">
          {data && (
            <span className="toolbar-count tabular" aria-live="polite">
              {data.meta.total.toLocaleString('vi-VN')} kết quả
            </span>
          )}
          <ColumnPicker
            options={columnOptions}
            hidden={hidden}
            onToggle={setVisible}
            onReset={reset}
          />
          {canImport && <ImportButton onClick={() => setImportOpen(true)} />}
          <ExportMenu
            options={exportOptions}
            onExport={handleExport}
            disabled={!data || data.meta.total === 0}
          />
        </div>
      </div>
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
            isLoading={isLoading}
            emptyText="Không có hàng hóa phù hợp"
            getRowId={(p) => p.id}
            sort={sort}
            onSortChange={(s) => resetFilters(() => setSort(s))}
            sortableIds={SORTABLE_IDS}
            sortHints={SORT_HINTS}
            resizable={{ storageKey: 'table:products', defaultWidths: DEFAULT_WIDTHS }}
            columnLabels={COLUMN_LABELS}
            onRowClick={(p) => setDrawer({ kind: 'view', id: p.id })}
            hiddenColumns={hidden}
          />
          <Pagination meta={data?.meta} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}

const EMPTY: Product[] = [];
