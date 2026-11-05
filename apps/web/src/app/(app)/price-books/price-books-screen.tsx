'use client';

import { Copy, Percent, RotateCcw, Save } from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

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
import { Button } from '@/components/ui/button';
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
import type { PriceGridRow } from '@/lib/api/types';
import { useAuthStore } from '@/lib/auth/store';
import { useBranchStore } from '@/lib/branch';
import { formatDecimal, formatMoney } from '@/lib/format';
import { can } from '@/lib/permissions';
import {
  cellKey,
  MAX_CHANGES_PER_SAVE,
  resolveDraft,
  summarizeDrafts,
  type CellDraft,
} from '@/lib/price-grid';
import {
  downloadPriceGridXlsx,
  fetchAllPriceGrid,
  usePriceGrid,
  useSaveGrid,
  type PriceGridFilterParams,
} from '@/lib/queries/price-books';
import { flattenCategories, useCategories } from '@/lib/queries/products';
import { buildHtmlDocument, exportFilename, saveBlob, type ExportColumn } from '@/lib/table-export';
import { decimalSortValue, sortRows, type SortValue } from '@/lib/table-sort';

import { BulkAdjustDialog } from './bulk-adjust-dialog';
import { CopyBranchDialog } from './copy-branch-dialog';

const ALL = 'all';
const PAGE_SIZE = 50;

/** Cột của file HTML: chữ thuần, mỗi bảng giá một cột (giá vốn chỉ khi đủ quyền). */
function exportColumnsFor(
  books: { id: string; name: string }[],
  canSeeCost: boolean,
): ExportColumn<PriceGridRow>[] {
  const cols: ExportColumn<PriceGridRow>[] = [
    { header: 'Mã hàng', value: (r) => r.code },
    { header: 'Tên hàng', value: (r) => r.name },
  ];
  if (canSeeCost) {
    cols.push({ header: 'Giá vốn (₫)', value: (r) => formatDecimal(r.costPrice), numeric: true });
  }
  for (const b of books) {
    cols.push({
      header: `${b.name} (₫)`,
      value: (r) => formatDecimal(r.prices[b.id]),
      numeric: true,
    });
  }
  return cols;
}

interface DraftsApi {
  drafts: Record<string, CellDraft>;
  canEdit: boolean;
  setDraft: (draft: CellDraft) => void;
}
// Cột được dựng một lần; ô giá đọc bản nháp qua context để KHÔNG dựng lại cột (mất focus khi gõ).
const DraftsContext = createContext<DraftsApi | null>(null);

/** Lưới giá theo chi nhánh làm việc. Đổi chi nhánh → dựng lại màn hình (bản nháp chưa lưu bị bỏ). */
export function PriceBooksScreen() {
  const branchId = useBranchStore((s) => s.branchId);
  return <PriceGridView key={branchId ?? 'none'} />;
}

function PriceGridView() {
  const me = useAuthStore((s) => s.user);
  const branchId = useBranchStore((s) => s.branchId);
  const canEdit = can(me, 'price.edit');
  const canSeeCost = can(me, 'product.cost.view');
  const canImport = can(me, 'import.run');
  const [importOpen, setImportOpen] = useState(false);
  const branchName = me?.branches.find((b) => b.id === branchId)?.name;

  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState<string>(ALL);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | null>(null);
  const [drafts, setDrafts] = useState<Record<string, CellDraft>>({});
  const [bulkOpen, setBulkOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const debouncedQ = useDebouncedValue(q.trim());

  // Bộ lọc dùng chung cho lưới, xuất Excel và xuất HTML (file luôn khớp màn hình).
  const filters: PriceGridFilterParams = {
    q: debouncedQ || undefined,
    categoryId: categoryId === ALL ? undefined : categoryId,
  };
  const { data, isLoading, isError, error } = usePriceGrid({
    ...filters,
    page,
    limit: PAGE_SIZE,
  });
  const { data: categoryTree } = useCategories();
  const categories = useMemo(() => flattenCategories(categoryTree ?? []), [categoryTree]);
  const save = useSaveGrid();

  const books = data?.books;
  const pending = useMemo(() => summarizeDrafts(drafts), [drafts]);
  const tooMany = pending.changes.length > MAX_CHANGES_PER_SAVE;
  const hasPending = pending.changes.length > 0 || pending.invalidCount > 0;

  // Cảnh báo khi đóng/tải lại trang lúc còn giá sửa dở.
  useEffect(() => {
    if (!hasPending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasPending]);

  const draftsApi = useMemo<DraftsApi>(
    () => ({
      drafts,
      canEdit,
      setDraft: (d) => setDrafts((prev) => ({ ...prev, [cellKey(d.productId, d.priceBookId)]: d })),
    }),
    [drafts, canEdit],
  );

  const columns = useMemo<AppColumnDef<PriceGridRow>[]>(() => {
    const cols: AppColumnDef<PriceGridRow>[] = [
      {
        id: 'code',
        header: 'Mã hàng',
        cell: ({ row }) => <span className="tabular">{row.original.code}</span>,
      },
      {
        id: 'name',
        header: 'Tên hàng',
        cell: ({ row }) => <span className="cell-title">{row.original.name}</span>,
      },
    ];
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
    for (const book of books ?? []) {
      cols.push({
        id: `book-${book.id}`,
        header: () => <span className="num">{book.name}</span>,
        cell: ({ row }) => <PriceCell row={row.original} bookId={book.id} bookName={book.name} />,
      });
    }
    return cols;
  }, [books, canSeeCost]);

  // Lưới giá chưa có tham số `sort` ở API → mọi cột sắp xếp trong trang đang xem.
  // Sắp xếp theo giá GỐC (đã lưu), không theo bản nháp, để dòng không nhảy khi đang gõ.
  const sortKit = useMemo(() => {
    const accessors: Record<string, (r: PriceGridRow) => SortValue> = {
      code: (r) => r.code,
      name: (r) => r.name,
      costPrice: (r) => decimalSortValue(r.costPrice),
    };
    const hints: Record<string, string> = {};
    const labels: Record<string, string> = {
      code: 'mã hàng',
      name: 'tên hàng',
      costPrice: 'giá vốn',
    };
    const widths: Record<string, number> = { code: 120, name: 280, costPrice: 130 };
    const editCells: Record<string, string> = {};
    for (const book of books ?? []) {
      const id = `book-${book.id}`;
      accessors[id] = (r) => decimalSortValue(r.prices[book.id]);
      labels[id] = book.name.toLowerCase();
      widths[id] = 140;
      editCells[id] = 'cell-edit';
    }
    for (const id of Object.keys(accessors)) hints[id] = 'Sắp xếp trong trang đang xem';
    return { accessors, hints, labels, widths, editCells, ids: Object.keys(accessors) };
  }, [books]);

  const rows = useMemo(
    () => sortRows(data?.data ?? EMPTY, sort, sortKit.accessors),
    [data, sort, sortKit],
  );

  const handleExport = async (format: ExportFormat) => {
    if (!branchId) return;
    if (format === 'xlsx') {
      const { blob, filename } = await downloadPriceGridXlsx(branchId, filters);
      saveBlob(blob, filename ?? exportFilename('thiet-lap-gia', 'xlsx'));
      return;
    }
    const grid = await fetchAllPriceGrid(branchId, filters);
    const html = buildHtmlDocument({
      title: 'Thiết lập giá',
      subtitle: branchName ? `Chi nhánh ${branchName}` : undefined,
      columns: exportColumnsFor(grid.books, canSeeCost),
      rows: sortRows(grid.data, sort, sortKit.accessors),
    });
    saveBlob(
      new Blob([html], { type: 'text/html;charset=utf-8' }),
      exportFilename('thiet-lap-gia', 'html'),
    );
  };

  const resetFilters = (fn: () => void) => {
    fn();
    setPage(1);
  };

  const onSave = async () => {
    if (!branchId || pending.changes.length === 0) return;
    try {
      const res = await save.mutateAsync({ branchId, changes: pending.changes });
      setDrafts({});
      toast.success(`Đã lưu giá: ${res.updated} ô thay đổi`);
    } catch (e) {
      // Server lưu "tất cả hoặc không gì cả": lỗi thì giữ nguyên bản nháp để sửa rồi lưu lại.
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Thiết lập giá"
        description={`Giá bán theo từng hạng giá của chi nhánh${branchName ? ` ${branchName}` : ''}. Giá là số nguyên đồng; để trống ô để xóa giá (khi bán sẽ lùi về Bảng giá chung của cùng chi nhánh).`}
        actions={
          canEdit ? (
            <>
              <Button variant="outline" onClick={() => setBulkOpen(true)}>
                <Percent /> Tăng/giảm hàng loạt
              </Button>
              {(me?.branches.length ?? 0) >= 2 && (
                <Button variant="outline" onClick={() => setCopyOpen(true)}>
                  <Copy /> Sao chép sang chi nhánh khác
                </Button>
              )}
            </>
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
        <div className="toolbar-end">
          {data && (
            <span className="toolbar-count tabular" aria-live="polite">
              {data.meta.total.toLocaleString('vi-VN')} kết quả
            </span>
          )}
          {canImport && (
            <ImportButton
              onClick={() => setImportOpen(true)}
              disabled={hasPending}
              title={
                hasPending ? 'Lưu hoặc hủy các ô giá đang sửa trước khi nhập Excel' : undefined
              }
            />
          )}
          <ExportMenu onExport={handleExport} disabled={!data || data.meta.total === 0} />
        </div>
      </div>
      {importOpen && <ImportDialog type="price-books" onClose={() => setImportOpen(false)} />}

      {canEdit && hasPending && (
        <div className="save-bar" role="status">
          <span>
            {pending.changes.length} ô thay đổi chưa lưu
            {pending.invalidCount > 0 && (
              <span className="save-bar-error">
                {' '}
                · {pending.invalidCount} ô sai (giá phải là số nguyên đồng, không âm)
              </span>
            )}
            {tooMany && (
              <span className="save-bar-error">
                {' '}
                · Tối đa {MAX_CHANGES_PER_SAVE} ô mỗi lần lưu, hãy lưu bớt rồi sửa tiếp
              </span>
            )}
          </span>
          <div className="save-bar-actions">
            <Button variant="ghost" onClick={() => setDrafts({})} disabled={save.isPending}>
              <RotateCcw /> Hủy thay đổi
            </Button>
            <Button
              onClick={onSave}
              disabled={
                save.isPending ||
                pending.changes.length === 0 ||
                pending.invalidCount > 0 ||
                tooMany
              }
            >
              <Save /> {save.isPending ? 'Đang lưu…' : 'Lưu thay đổi'}
            </Button>
          </div>
        </div>
      )}

      {isError ? (
        <p className="alert alert-error" role="alert">
          {errorMessage(error)}
        </p>
      ) : (
        <DraftsContext.Provider value={draftsApi}>
          <DataTable
            columns={columns}
            data={rows}
            isLoading={isLoading}
            emptyText="Không có hàng hóa phù hợp"
            getRowId={(r) => r.productId}
            sort={sort}
            onSortChange={setSort}
            sortableIds={sortKit.ids}
            sortHints={sortKit.hints}
            resizable={{ storageKey: 'table:price-grid', defaultWidths: sortKit.widths }}
            columnLabels={sortKit.labels}
            cellClassNames={canEdit ? sortKit.editCells : undefined}
          />
          <Pagination meta={data?.meta} onPageChange={setPage} />
        </DraftsContext.Provider>
      )}

      {bulkOpen && branchId && books && (
        <BulkAdjustDialog
          branchId={branchId}
          branchName={branchName}
          books={books}
          categories={categories}
          pendingCount={pending.changes.length + pending.invalidCount}
          onClose={() => setBulkOpen(false)}
        />
      )}
      {copyOpen && branchId && books && me && (
        <CopyBranchDialog
          workingBranchId={branchId}
          branches={me.branches}
          books={books}
          pendingCount={pending.changes.length + pending.invalidCount}
          onClose={() => setCopyOpen(false)}
        />
      )}
    </div>
  );
}

/** Một ô giá: ô nhập khi có quyền `price.edit`, ngược lại chỉ hiển thị. */
function PriceCell({
  row,
  bookId,
  bookName,
}: {
  row: PriceGridRow;
  bookId: string;
  bookName: string;
}) {
  const ctx = useContext(DraftsContext);
  const original = row.prices[bookId] ?? null;
  if (!ctx) return null;

  if (!ctx.canEdit) {
    return original === null ? (
      <span className="num muted">—</span>
    ) : (
      <span className="num">{formatMoney(original)}</span>
    );
  }

  const draft = ctx.drafts[cellKey(row.productId, bookId)];
  const value = draft ? draft.raw : (original ?? '');
  const result = draft ? resolveDraft(draft.original, draft.raw) : null;
  return (
    <Input
      className="price-input"
      inputMode="numeric"
      autoComplete="off"
      value={value}
      placeholder="Chưa có"
      aria-label={`Giá ${bookName} của ${row.code}`}
      aria-invalid={result?.kind === 'invalid' ? true : undefined}
      data-changed={result?.kind === 'change' ? 'true' : undefined}
      onChange={(e) =>
        ctx.setDraft({
          productId: row.productId,
          priceBookId: bookId,
          original,
          raw: e.target.value,
        })
      }
    />
  );
}

const EMPTY: PriceGridRow[] = [];
