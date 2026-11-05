'use client';

import { tableFeatures, useTable, type ColumnDef, type RowData } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MIN_COLUMN_WIDTH, useColumnWidths, type ColumnWidths } from '@/hooks/use-column-widths';
import { cn } from '@/lib/utils';

/**
 * Bảng dữ liệu dùng chung (TanStack Table v9). Phân trang/lọc/sắp xếp do server làm
 * (docs/api/README.md mục 4) nên bảng chỉ dựng dòng/cột từ trang dữ liệu hiện tại.
 *
 * Tùy chọn (mặc định tắt, các màn hình cũ không đổi):
 * - `sort` + `onSortChange` + `sortableIds`: bấm tiêu đề để sắp xếp (tăng → giảm → bỏ), do màn hình đẩy lên server.
 * - `resizable`: kéo mép tiêu đề để đổi độ rộng cột (nhớ theo trình duyệt), kèm kẻ cột.
 */
const features = tableFeatures({});
export type AppColumnDef<TData extends RowData> = ColumnDef<typeof features, TData, unknown>;

export interface SortState {
  id: string;
  desc: boolean;
}

export interface ResizableOptions {
  /** Khóa lưu độ rộng trong localStorage, vd. `table:products`. */
  storageKey: string;
  /** Độ rộng mặc định (px) theo id cột; cột thiếu dùng 160. */
  defaultWidths: ColumnWidths;
}

const FALLBACK_WIDTH = 160;
const NO_WIDTHS: ColumnWidths = {};

export function DataTable<TData extends RowData>({
  columns,
  data,
  isLoading,
  emptyText = 'Không có dữ liệu',
  getRowId,
  sort,
  onSortChange,
  sortableIds,
  resizable,
  columnLabels,
}: {
  columns: AppColumnDef<TData>[];
  data: TData[];
  isLoading?: boolean;
  emptyText?: string;
  getRowId?: (row: TData) => string;
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  sortableIds?: readonly string[];
  resizable?: ResizableOptions;
  /** Tên cột (chữ thường) cho nhãn trợ năng của tay nắm kéo; thiếu thì dùng id cột. */
  columnLabels?: Record<string, string>;
}) {
  const table = useTable({ features, columns, data, getRowId });
  const { widths, setWidth, resetWidth } = useColumnWidths(
    resizable?.storageKey ?? 'table:unused',
    resizable?.defaultWidths ?? NO_WIDTHS,
  );

  const widthOf = (id: string) => widths[id] ?? resizable?.defaultWidths[id] ?? FALLBACK_WIDTH;
  const canSort = (id: string) => !!onSortChange && !!sortableIds?.includes(id);
  // asc → desc → bỏ sắp xếp.
  const nextSort = (id: string): SortState | null => {
    if (sort?.id !== id) return { id, desc: false };
    return sort.desc ? null : { id, desc: true };
  };

  const ids = table.getAllLeafColumns().map((c) => c.id);
  const totalWidth = resizable ? ids.reduce((sum, id) => sum + widthOf(id), 0) : undefined;

  return (
    <div className="data-table-frame">
      <Table
        className={cn(resizable && 'data-table-fixed')}
        style={resizable ? { width: totalWidth, minWidth: '100%' } : undefined}
      >
        {resizable && (
          <colgroup>
            {ids.map((id) => (
              <col key={id} style={{ width: widthOf(id) }} />
            ))}
          </colgroup>
        )}
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const id = header.column.id;
                const sortable = canSort(id);
                const dir = sort?.id === id ? (sort.desc ? 'descending' : 'ascending') : 'none';
                const content = header.isPlaceholder ? null : <table.FlexRender header={header} />;
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={sortable ? dir : undefined}
                    className={cn(sortable && 'is-sortable')}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        className="sort-button"
                        onClick={() => onSortChange?.(nextSort(id))}
                        title="Bấm để sắp xếp"
                      >
                        <span className="sort-label">{content}</span>
                        <span className="sort-indicator" aria-hidden="true">
                          {dir === 'ascending' ? (
                            <ArrowUp />
                          ) : dir === 'descending' ? (
                            <ArrowDown />
                          ) : (
                            <ChevronsUpDown />
                          )}
                        </span>
                      </button>
                    ) : (
                      content
                    )}
                    {resizable && (
                      <ColumnResizer
                        label={columnLabels?.[id] ?? id}
                        width={widthOf(id)}
                        onResize={(w) => setWidth(id, w)}
                        onReset={() => resetWidth(id)}
                      />
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {isLoading && data.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={`sk-${i}`}>
                {columns.map((_, j) => (
                  <TableCell key={j}>
                    <Skeleton className="skeleton-line" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="data-table-empty">
                {emptyText}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/** Tay nắm kéo mép phải tiêu đề: chuột/cảm ứng (kéo), bàn phím (←/→, Shift = bước lớn), nhấp đúp = đặt lại. */
function ColumnResizer({
  label,
  width,
  onResize,
  onReset,
}: {
  label: string;
  width: number;
  onResize: (width: number) => void;
  onReset: () => void;
}) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLSpanElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { startX: e.clientX, startWidth: width };
      document.body.classList.add('is-col-resizing');
    },
    [width],
  );
  const onPointerMove = (e: PointerEvent<HTMLSpanElement>) => {
    if (drag.current) onResize(drag.current.startWidth + e.clientX - drag.current.startX);
  };
  const end = (e: PointerEvent<HTMLSpanElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.classList.remove('is-col-resizing');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === 'ArrowRight') onResize(width + step);
    else if (e.key === 'ArrowLeft') onResize(width - step);
    else return;
    e.preventDefault();
  };

  return (
    <span
      className="column-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Độ rộng cột ${label}`}
      aria-valuemin={MIN_COLUMN_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      title="Kéo để đổi độ rộng · nhấp đúp để đặt lại"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
    />
  );
}
