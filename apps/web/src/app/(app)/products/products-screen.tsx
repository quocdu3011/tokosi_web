'use client';

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { PageHeader } from '@/components/common/coming-soon';
import { DataTable, type AppColumnDef, type SortState } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import {
  ExportMenu,
  ImportButton,
  TableSearch,
  type ExportFormat,
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
  useUpdateProduct,
  type ProductFilterParams,
} from '@/lib/queries/products';
import { buildHtmlDocument, exportFilename, saveBlob, type ExportColumn } from '@/lib/table-export';
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
  actions: 170,
};
const COLUMN_LABELS: Record<string, string> = {
  code: 'mã hàng',
  name: 'tên hàng',
  costPrice: 'giá vốn',
  onHand: 'tồn kho',
  reserved: 'khách đặt',
  available: 'có thể bán',
  status: 'trạng thái',
  actions: 'thao tác',
};

/** Danh sách hàng hóa theo chi nhánh làm việc (tồn kho, giá vốn riêng từng chi nhánh). */
export function ProductsScreen() {
  const me = useAuthStore((s) => s.user);
  const canSeeCost = can(me, 'product.cost.view');
  const canImport = can(me, 'import.run');
  const canEdit = can(me, 'product.edit');
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [toToggle, setToToggle] = useState<Product | null>(null);
  const updateProduct = useUpdateProduct();
  const [importOpen, setImportOpen] = useState(false);

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
  const { data: categoryTree } = useCategories();
  const categories = useMemo(() => flattenCategories(categoryTree ?? []), [categoryTree]);

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
            {row.original.categoryPath && (
              <span className="cell-sub">{row.original.categoryPath}</span>
            )}
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
    if (canEdit) {
      cols.push({
        id: 'actions',
        header: () => <span className="sr-only">Thao tác</span>,
        cell: ({ row }) => (
          <div className="cell-actions">
            <Button variant="ghost" size="sm" onClick={() => setToToggle(row.original)}>
              {row.original.isActive ? 'Ngừng kinh doanh' : 'Kích hoạt lại'}
            </Button>
          </div>
        ),
      });
    }
    return cols;
  }, [canSeeCost, canEdit]);

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
      {
        header: 'Trạng thái',
        value: (p) => (p.isActive ? 'Đang kinh doanh' : 'Ngừng kinh doanh'),
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
    const all = await fetchAllProducts(filters);
    const html = buildHtmlDocument({
      title: 'Danh sách hàng hóa',
      subtitle: debouncedQ ? `Tìm: "${debouncedQ}"` : undefined,
      columns: exportColumns,
      rows: sortRows(all, sort, PAGE_SORT),
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
          {canImport && <ImportButton onClick={() => setImportOpen(true)} />}
          <ExportMenu onExport={handleExport} disabled={!data || data.meta.total === 0} />
        </div>
      </div>
      {importOpen && <ImportDialog type="products" onClose={() => setImportOpen(false)} />}
      {drawer && <ProductDrawer target={drawer} onClose={() => setDrawer(null)} />}
      {toToggle && (
        <ConfirmDialog
          title={toToggle.isActive ? 'Ngừng kinh doanh hàng này?' : 'Kích hoạt lại hàng này?'}
          description={
            toToggle.isActive
              ? `${toToggle.code} · ${toToggle.name} sẽ không còn được chọn khi lập đơn. Dữ liệu và lịch sử giữ nguyên, có thể kích hoạt lại bất cứ lúc nào.`
              : `${toToggle.code} · ${toToggle.name} sẽ được kinh doanh trở lại.`
          }
          confirmLabel={toToggle.isActive ? 'Ngừng kinh doanh' : 'Kích hoạt lại'}
          destructive={toToggle.isActive}
          onConfirm={async () => {
            await updateProduct.mutateAsync({
              id: toToggle.id,
              patch: { isActive: !toToggle.isActive },
            });
            toast.success(toToggle.isActive ? 'Đã ngừng kinh doanh' : 'Đã kích hoạt lại');
          }}
          onClose={() => setToToggle(null)}
        />
      )}

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
          />
          <Pagination meta={data?.meta} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}

const EMPTY: Product[] = [];
