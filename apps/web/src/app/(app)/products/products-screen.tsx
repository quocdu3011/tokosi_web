'use client';

import { useMemo, useState } from 'react';

import { PageHeader } from '@/components/common/coming-soon';
import { DataTable, type AppColumnDef, type SortState } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { ExportMenu, TableSearch, type ExportFormat } from '@/components/data-table/table-toolbar';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { errorMessage } from '@/lib/api';
import type { Product } from '@/lib/api/types';
import { useAuthStore } from '@/lib/auth/store';
import { formatDecimal, formatMoney } from '@/lib/format';
import { can } from '@/lib/permissions';
import {
  downloadProductsXlsx,
  fetchAllProducts,
  flattenCategories,
  useCategories,
  useProductList,
  type ProductFilterParams,
} from '@/lib/queries/products';
import { buildHtmlDocument, exportFilename, saveBlob, type ExportColumn } from '@/lib/table-export';

const ALL = 'all';
const PAGE_SIZE = 20;

/** Cột server cho phép sắp xếp (endpoints.md mục 2.1: `code`, `name`, `onHand`, `createdAt`). */
const SORTABLE_IDS = ['code', 'name', 'onHand'] as const;

/** Độ rộng mặc định (px) từng cột; người dùng kéo mép tiêu đề để đổi, được nhớ theo trình duyệt. */
const DEFAULT_WIDTHS = {
  code: 120,
  name: 320,
  unit: 80,
  basePrice: 140,
  costPrice: 140,
  onHand: 110,
  reserved: 110,
  available: 120,
  location: 120,
  status: 210,
};
const COLUMN_LABELS: Record<string, string> = {
  code: 'mã hàng',
  name: 'tên hàng',
  unit: 'đơn vị tính',
  basePrice: 'giá bán',
  costPrice: 'giá vốn',
  onHand: 'tồn kho',
  reserved: 'khách đặt',
  available: 'có thể bán',
  location: 'vị trí',
  status: 'trạng thái',
};

/** Danh sách hàng hóa theo chi nhánh làm việc (giá bán, tồn kho riêng từng chi nhánh). */
export function ProductsScreen() {
  const me = useAuthStore((s) => s.user);
  const canSeeCost = can(me, 'product.cost.view');

  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState<string>(ALL);
  const [status, setStatus] = useState<string>('active');
  const [stock, setStock] = useState<string>(ALL);
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);
  const debouncedQ = useDebouncedValue(q.trim());

  // Bộ lọc + sắp xếp dùng chung cho danh sách, xuất Excel và xuất HTML (file luôn khớp màn hình).
  const filters: ProductFilterParams = {
    q: debouncedQ || undefined,
    categoryId: categoryId === ALL ? undefined : categoryId,
    isActive: status === ALL ? undefined : status === 'active',
    inStock: stock === 'in' ? true : undefined,
    sort: sort ? `${sort.desc ? '-' : ''}${sort.id}` : undefined,
  };
  const { data, isLoading, isError, error } = useProductList({
    ...filters,
    page,
    limit: PAGE_SIZE,
  });
  const { data: categoryTree } = useCategories();
  const categories = useMemo(() => flattenCategories(categoryTree ?? []), [categoryTree]);

  const columns = useMemo<AppColumnDef<Product>[]>(() => {
    const cols: AppColumnDef<Product>[] = [
      {
        id: 'code',
        header: 'Mã hàng',
        cell: ({ row }) => <span className="tabular">{row.original.code}</span>,
      },
      {
        id: 'name',
        header: 'Tên hàng',
        cell: ({ row }) => (
          <div className="cell-stack">
            <span className="cell-title">{row.original.name}</span>
            {row.original.categoryPath && (
              <span className="cell-sub">{row.original.categoryPath}</span>
            )}
          </div>
        ),
      },
      { id: 'unit', header: 'ĐVT', cell: ({ row }) => row.original.unit },
      {
        id: 'basePrice',
        header: () => <span className="num">Giá bán</span>,
        // `null` = chưa có giá ở Bảng giá chung của chi nhánh này.
        cell: ({ row }) =>
          row.original.basePrice === null ? (
            <span className="num muted">Chưa có giá</span>
          ) : (
            <span className="num">{formatMoney(row.original.basePrice)}</span>
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
    }
    cols.push(
      {
        id: 'onHand',
        header: () => <span className="num">Tồn kho</span>,
        cell: ({ row }) => {
          const { onHand, minStock } = row.original;
          const low = minStock !== null && Number(onHand) < Number(minStock);
          return (
            <span
              className={low ? 'num stock-low' : 'num'}
              title={low ? 'Dưới tồn tối thiểu' : undefined}
            >
              {formatDecimal(onHand) || '0'}
            </span>
          );
        },
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
      { id: 'location', header: 'Vị trí', cell: ({ row }) => row.original.location ?? '' },
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
            {!row.original.isSellable && <Badge variant="secondary">Không bán</Badge>}
          </div>
        ),
      },
    );
    return cols;
  }, [canSeeCost]);

  const resetFilters = (fn: () => void) => {
    fn();
    setPage(1);
  };

  /** Cột & định dạng của file HTML — giống cách hiển thị trên màn hình, nhưng là chữ thuần. */
  const exportColumns = useMemo<ExportColumn<Product>[]>(() => {
    const cols: ExportColumn<Product>[] = [
      { header: 'Mã hàng', value: (p) => p.code },
      { header: 'Tên hàng', value: (p) => p.name },
      { header: 'Nhóm hàng', value: (p) => p.categoryPath ?? '' },
      { header: 'ĐVT', value: (p) => p.unit },
      { header: 'Giá bán (₫)', value: (p) => formatDecimal(p.basePrice), numeric: true },
    ];
    if (canSeeCost) {
      cols.push({
        header: 'Giá vốn (₫)',
        value: (p) => formatDecimal(p.costPrice),
        numeric: true,
      });
    }
    cols.push(
      { header: 'Tồn kho', value: (p) => formatDecimal(p.onHand) || '0', numeric: true },
      { header: 'Khách đặt', value: (p) => formatDecimal(p.reserved) || '0', numeric: true },
      { header: 'Có thể bán', value: (p) => formatDecimal(p.available) || '0', numeric: true },
      { header: 'Vị trí', value: (p) => p.location ?? '' },
      {
        header: 'Trạng thái',
        value: (p) =>
          [p.isActive ? 'Đang kinh doanh' : 'Ngừng kinh doanh', p.isSellable ? '' : 'Không bán']
            .filter(Boolean)
            .join(', '),
      },
    );
    return cols;
  }, [canSeeCost]);

  const handleExport = async (format: ExportFormat) => {
    if (format === 'xlsx') {
      const { blob, filename } = await downloadProductsXlsx(filters);
      saveBlob(blob, filename ?? exportFilename('hang-hoa', 'xlsx'));
      return;
    }
    const rows = await fetchAllProducts(filters);
    const html = buildHtmlDocument({
      title: 'Danh sách hàng hóa',
      subtitle: debouncedQ ? `Tìm: "${debouncedQ}"` : undefined,
      columns: exportColumns,
      rows,
    });
    saveBlob(
      new Blob([html], { type: 'text/html;charset=utf-8' }),
      exportFilename('hang-hoa', 'html'),
    );
  };

  return (
    <div className="page">
      <PageHeader
        title="Danh sách hàng hóa"
        description="Giá bán, tồn kho và giá vốn hiển thị theo chi nhánh đang làm việc."
      />

      <div className="toolbar">
        <TableSearch
          value={q}
          onChange={(v) => resetFilters(() => setQ(v))}
          placeholder="Tìm mã hoặc tên hàng"
          label="Tìm hàng hóa"
        />
        <Select value={categoryId} onValueChange={(v) => resetFilters(() => setCategoryId(v))}>
          <SelectTrigger aria-label="Lọc theo nhóm hàng" className="toolbar-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Mọi nhóm hàng</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {'  '.repeat(c.depth)}
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
        <div className="toolbar-end">
          {data && (
            <span className="toolbar-count tabular" aria-live="polite">
              {data.meta.total.toLocaleString('vi-VN')} kết quả
            </span>
          )}
          <ExportMenu onExport={handleExport} disabled={!data || data.meta.total === 0} />
        </div>
      </div>

      {isError ? (
        <p className="alert alert-error" role="alert">
          {errorMessage(error)}
        </p>
      ) : (
        <>
          <DataTable
            columns={columns}
            data={data?.data ?? EMPTY}
            isLoading={isLoading}
            emptyText="Không có hàng hóa phù hợp"
            getRowId={(p) => p.id}
            sort={sort}
            onSortChange={(s) => resetFilters(() => setSort(s))}
            sortableIds={SORTABLE_IDS}
            resizable={{ storageKey: 'table:products', defaultWidths: DEFAULT_WIDTHS }}
            columnLabels={COLUMN_LABELS}
          />
          <Pagination meta={data?.meta} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}

const EMPTY: Product[] = [];
