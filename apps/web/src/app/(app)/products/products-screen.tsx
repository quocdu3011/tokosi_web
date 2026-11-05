'use client';

import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { PageHeader } from '@/components/common/coming-soon';
import { DataTable, type AppColumnDef } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
import { flattenCategories, useCategories, useProductList } from '@/lib/queries/products';

const ALL = 'all';
const PAGE_SIZE = 20;

/** Danh sách hàng hóa theo chi nhánh làm việc (giá bán, tồn kho riêng từng chi nhánh). */
export function ProductsScreen() {
  const me = useAuthStore((s) => s.user);
  const canSeeCost = can(me, 'product.cost.view');

  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState<string>(ALL);
  const [status, setStatus] = useState<string>('active');
  const [stock, setStock] = useState<string>(ALL);
  const [page, setPage] = useState(1);
  const debouncedQ = useDebouncedValue(q.trim());

  const { data, isLoading, isError, error } = useProductList({
    q: debouncedQ || undefined,
    categoryId: categoryId === ALL ? undefined : categoryId,
    isActive: status === ALL ? undefined : status === 'active',
    inStock: stock === 'in' ? true : undefined,
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

  return (
    <div className="page">
      <PageHeader
        title="Danh sách hàng hóa"
        description="Giá bán, tồn kho và giá vốn hiển thị theo chi nhánh đang làm việc."
      />

      <div className="toolbar">
        <div className="toolbar-search">
          <Search aria-hidden="true" />
          <Input
            value={q}
            onChange={(e) => resetFilters(() => setQ(e.target.value))}
            placeholder="Tìm mã hoặc tên hàng"
            aria-label="Tìm hàng hóa"
          />
        </div>
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
          />
          <Pagination meta={data?.meta} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}

const EMPTY: Product[] = [];
