'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type Modifier,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  type SortingStrategy,
} from '@dnd-kit/sortable';
import {
  metaHelper,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown, GripVertical } from 'lucide-react';
import {
  useCallback,
  useId,
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useColumnWidths,
  type ColumnWidths as LegacyColumnWidths,
} from '@/hooks/use-column-widths';
import type { TablePrefsController } from '@/hooks/use-table-prefs';
import { cn } from '@/lib/utils';

import {
  columnSpecs,
  DEFAULT_COLUMN_WIDTH,
  sortHintsOf,
  sortableIdsOf,
  type ColumnSpec,
  type TableColumnMeta,
} from './column-meta';
import { MIN_COLUMN_WIDTH } from './prefs-core';

export type { TableColumnMeta } from './column-meta';

/**
 * Bảng dữ liệu dùng chung (TanStack Table v9). Phân trang/lọc/sắp xếp do server làm
 * (docs/api/README.md mục 4) nên bảng chỉ dựng dòng/cột từ trang dữ liệu hiện tại.
 *
 * Mô tả cột (nhãn, độ rộng, ẩn mặc định, khóa, sắp xếp) khai ở `meta` của từng ColumnDef — xem {@link TableColumnMeta}.
 *
 * Cách dùng MỚI (khuyến nghị): `prefs={useTablePrefs('khoa-bang', columns)}` — ẩn/hiện, thứ tự (kéo thả tiêu đề)
 * và độ rộng (kéo mép tiêu đề) cột được lưu THEO TÀI KHOẢN trên server.
 *
 * Tùy chọn cũ (giữ nguyên để màn hình chưa chuyển vẫn chạy; sẽ gỡ sau):
 * - `sort` + `onSortChange` + `sortableIds`: bấm tiêu đề để sắp xếp (tăng → giảm → bỏ), do màn hình đẩy lên server.
 * - `resizable`: kéo mép tiêu đề để đổi độ rộng cột (nhớ theo trình duyệt), kèm kẻ cột.
 * - `hiddenColumns`: id các cột ẩn (hook `useColumnVisibility` cũ).
 */
const features = tableFeatures({ columnMeta: metaHelper<TableColumnMeta>() });
export type AppColumnDef<TData extends RowData> = ColumnDef<typeof features, TData, unknown>;

export interface SortState {
  id: string;
  desc: boolean;
}

export interface ResizableOptions {
  /** Khóa lưu độ rộng trong localStorage, vd. `table:products`. */
  storageKey: string;
  /** Độ rộng mặc định (px) theo id cột; cột thiếu dùng 160. */
  defaultWidths: LegacyColumnWidths;
}

const NO_WIDTHS: LegacyColumnWidths = {};

/** Kéo thả đổi thứ tự cột: tiêu đề không dịch chỗ, chỉ cột đang kéo đi theo con trỏ + vạch báo nơi thả. */
const noShiftStrategy: SortingStrategy = () => null;

/** Phải kéo ≥ 6px mới tính là kéo thả: bấm nút sắp xếp và kéo mép cột không bị phá. */
const POINTER_ACTIVATION = { distance: 6 };

const DRAG_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    'Để đổi chỗ cột: nhấn phím cách để nhấc, dùng mũi tên trái/phải để di chuyển, nhấn phím cách để thả, Esc để hủy.',
};

export function DataTable<TData extends RowData>({
  columns: allColumns,
  data,
  isLoading,
  emptyText = 'Không có dữ liệu',
  getRowId,
  sort,
  onSortChange,
  sortableIds,
  resizable,
  columnLabels,
  sortHints,
  cellClassNames,
  onRowClick,
  hiddenColumns,
  prefs,
}: {
  columns: AppColumnDef<TData>[];
  data: TData[];
  isLoading?: boolean;
  emptyText?: string;
  getRowId?: (row: TData) => string;
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  /** Thêm vào các cột có `meta.sort`; mặc định chỉ dùng `meta.sort`. */
  sortableIds?: readonly string[];
  /** (Cũ) độ rộng nhớ theo trình duyệt. Có `prefs` thì dùng `prefs.widths`. */
  resizable?: ResizableOptions;
  /** (Cũ) tên cột (chữ thường) cho nhãn trợ năng của tay nắm kéo; mặc định lấy từ `meta.label`. */
  columnLabels?: Record<string, string>;
  /** Gợi ý (tooltip) riêng cho nút sắp xếp từng cột; ghi đè `meta.sortHint`. */
  sortHints?: Record<string, string>;
  /** Lớp CSS thêm cho ô dữ liệu (`td`) theo id cột, vd. `cell-edit` cho ô nhập liệu. */
  cellClassNames?: Record<string, string>;
  /** Bấm vào chỗ trống bất kỳ của dòng (không phải nút/liên kết) để mở chi tiết. */
  onRowClick?: (row: TData) => void;
  /** (Cũ) id các cột đang ẩn (hook `useColumnVisibility`). Gộp với `prefs.hidden` nếu có cả hai. */
  hiddenColumns?: ReadonlySet<string>;
  /**
   * Tùy chỉnh cột theo tài khoản (`useTablePrefs`): ẩn cột theo `prefs.hidden`, xếp theo `prefs.order`,
   * độ rộng từ `prefs.widths`, kéo thả tiêu đề để đổi chỗ, kéo mép để đổi độ rộng. Bật bố cục cột cố định như `resizable`.
   */
  prefs?: TablePrefsController;
}) {
  const specs = useMemo(() => columnSpecs(allColumns), [allColumns]);
  const specById = useMemo(() => new Map(specs.map((spec) => [spec.id, spec])), [specs]);

  const prefsOrder = prefs?.order;
  const prefsHidden = prefs?.hidden;
  const columns = useMemo(() => {
    let list = allColumns;
    if (prefsOrder) {
      const byId = new Map(allColumns.map((c) => [c.id ?? '', c]));
      const ordered = prefsOrder.flatMap((id) => {
        const column = byId.get(id);
        return column ? [column] : [];
      });
      const placed = new Set(prefsOrder);
      list = [...ordered, ...allColumns.filter((c) => !placed.has(c.id ?? ''))];
    }
    const isHidden = (id: string) =>
      (prefsHidden?.has(id) ?? false) || (hiddenColumns?.has(id) ?? false);
    return list.some((c) => isHidden(c.id ?? ''))
      ? list.filter((c) => !isHidden(c.id ?? ''))
      : list;
  }, [allColumns, prefsOrder, prefsHidden, hiddenColumns]);

  const table = useTable({ features, columns, data, getRowId });
  const legacy = useColumnWidths(
    resizable?.storageKey ?? 'table:unused',
    resizable?.defaultWidths ?? NO_WIDTHS,
  );

  const fixedLayout = !!prefs || !!resizable;
  const metaWidth = (id: string) => specById.get(id)?.width ?? DEFAULT_COLUMN_WIDTH;
  const widthOf = (id: string) =>
    prefs
      ? (prefs.widths[id] ?? metaWidth(id))
      : (legacy.widths[id] ?? resizable?.defaultWidths[id] ?? metaWidth(id));
  const changeWidth = (id: string, width: number) =>
    prefs ? prefs.setWidth(id, width) : legacy.setWidth(id, width);
  const restoreWidth = (id: string) => (prefs ? prefs.resetWidth(id) : legacy.resetWidth(id));
  const labelOf = useCallback(
    (id: string) => columnLabels?.[id] ?? specById.get(id)?.label.toLocaleLowerCase('vi-VN') ?? id,
    [columnLabels, specById],
  );

  const sortable = useMemo(
    () => new Set([...(sortableIds ?? []), ...sortableIdsOf(allColumns)]),
    [sortableIds, allColumns],
  );
  const hints = useMemo(
    () => ({ ...sortHintsOf(allColumns), ...sortHints }),
    [allColumns, sortHints],
  );
  const canSort = (id: string) => !!onSortChange && sortable.has(id);
  // asc → desc → bỏ sắp xếp.
  const nextSort = (id: string): SortState | null => {
    if (sort?.id !== id) return { id, desc: false };
    return sort.desc ? null : { id, desc: true };
  };

  const ids = table.getAllLeafColumns().map((c) => c.id);
  const totalWidth = fixedLayout ? ids.reduce((sum, id) => sum + widthOf(id), 0) : undefined;

  const headerCells = table.getHeaderGroups().map((group) => (
    <TableRow key={group.id}>
      {group.headers.map((header) => {
        const id = header.column.id;
        const cell: HeaderCellModel = {
          label: labelOf(id),
          content: header.isPlaceholder ? null : <table.FlexRender header={header} />,
          sortable: canSort(id),
          dir: sort?.id === id ? (sort.desc ? 'descending' : 'ascending') : 'none',
          sortHint: hints[id],
          onSort: () => onSortChange?.(nextSort(id)),
          resizer: fixedLayout
            ? {
                width: widthOf(id),
                onResize: (w: number) => changeWidth(id, w),
                onReset: () => restoreWidth(id),
              }
            : null,
        };
        return prefs ? (
          <SortableHeaderCell
            key={header.id}
            id={id}
            cell={cell}
            locked={specById.get(id)?.locked === true}
          />
        ) : (
          <HeaderCell key={header.id} cell={cell} />
        );
      })}
    </TableRow>
  ));

  const body = (
    <Table
      className={cn(fixedLayout && 'data-table-fixed')}
      style={fixedLayout ? { width: totalWidth, minWidth: '100%' } : undefined}
    >
      {fixedLayout && (
        <colgroup>
          {ids.map((id) => (
            <col key={id} style={{ width: widthOf(id) }} />
          ))}
        </colgroup>
      )}
      <TableHeader>{headerCells}</TableHeader>
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
            <TableRow
              key={row.id}
              className={onRowClick ? 'row-clickable' : undefined}
              onClick={
                onRowClick
                  ? (e) => {
                      // Bấm vào nút/liên kết/ô nhập trong dòng thì để chính phần tử đó xử lý.
                      if (
                        (e.target as HTMLElement).closest(
                          'button, a, input, select, textarea, label',
                        )
                      )
                        return;
                      onRowClick(row.original);
                    }
                  : undefined
              }
            >
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id} className={cellClassNames?.[cell.column.id]}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );

  return (
    <div className="data-table-frame">
      {prefs ? (
        <ColumnReorder ids={ids} specs={specs} labelOf={labelOf} onReorder={prefs.setOrder}>
          {body}
        </ColumnReorder>
      ) : (
        body
      )}
    </div>
  );
}

type SortDir = 'ascending' | 'descending' | 'none';

/** Mọi thứ cần để vẽ nội dung một ô tiêu đề (không gồm phần kéo thả). */
interface HeaderCellModel {
  /** Tên cột (chữ thường) cho nhãn trợ năng. */
  label: string;
  content: ReactNode;
  sortable: boolean;
  dir: SortDir;
  sortHint?: string;
  onSort: () => void;
  resizer: { width: number; onResize: (width: number) => void; onReset: () => void } | null;
}

/** Nội dung ô tiêu đề: nút sắp xếp (nếu có) + tay nắm kéo mép. */
function HeaderInner({ cell }: { cell: HeaderCellModel }) {
  const { label, content, sortable, dir, sortHint, onSort, resizer } = cell;
  return (
    <>
      {sortable ? (
        <button
          type="button"
          className="sort-button"
          onClick={onSort}
          title={sortHint ?? 'Bấm để sắp xếp'}
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
      {resizer && (
        <ColumnResizer
          label={label}
          width={resizer.width}
          onResize={resizer.onResize}
          onReset={resizer.onReset}
        />
      )}
    </>
  );
}

/** Ô tiêu đề thường (không kéo thả). */
function HeaderCell({ cell }: { cell: HeaderCellModel }) {
  return (
    <TableHead
      aria-sort={cell.sortable ? cell.dir : undefined}
      className={cn(cell.sortable && 'is-sortable')}
    >
      <HeaderInner cell={cell} />
    </TableHead>
  );
}

/**
 * Ô tiêu đề kéo thả được (dnd-kit sortable). Con trỏ kéo cả ô tiêu đề (cần dịch ≥ 6px mới tính là kéo nên
 * bấm sắp xếp vẫn ăn); bàn phím dùng nút tay nắm ẩn (chỉ hiện khi được focus). Cột `locked` không kéo được.
 */
function SortableHeaderCell({
  id,
  cell,
  locked,
}: {
  id: string;
  cell: HeaderCellModel;
  locked: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    isDragging,
    isOver,
    index,
    activeIndex,
  } = useSortable({
    id,
    disabled: { draggable: locked, droppable: false },
    transition: null,
    animateLayoutChanges: () => false,
  });
  const style: CSSProperties | undefined = transform
    ? { transform: `translate(${Math.round(transform.x)}px, 0)` }
    : undefined;
  // Vạch báo nơi thả nằm ở cạnh cột đang bị kéo qua: bên phải nếu kéo sang phải, bên trái nếu kéo sang trái.
  const drop = isOver && !isDragging ? (activeIndex < index ? 'after' : 'before') : undefined;
  return (
    <TableHead
      {...(locked ? undefined : listeners)}
      ref={setNodeRef}
      style={style}
      data-drop={drop}
      aria-sort={cell.sortable ? cell.dir : undefined}
      className={cn(
        cell.sortable && 'is-sortable',
        !locked && 'is-col-draggable',
        isDragging && 'is-col-dragging',
      )}
    >
      {!locked && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          className="col-drag-grip"
          aria-label={`Đổi chỗ cột ${cell.label}`}
        >
          <GripVertical aria-hidden="true" />
        </button>
      )}
      <HeaderInner cell={cell} />
    </TableHead>
  );
}

/** Bọc bảng để kéo thả đổi thứ tự cột; `onReorder` nhận thứ tự mới của các cột đang hiện. */
function ColumnReorder({
  ids,
  specs,
  labelOf,
  onReorder,
  children,
}: {
  ids: string[];
  specs: ColumnSpec[];
  labelOf: (id: string) => string;
  onReorder: (ids: string[]) => void;
  children: ReactNode;
}) {
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: POINTER_ACTIVATION }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Không thả lên cột khóa: bỏ chúng khỏi danh sách ứng viên va chạm.
  const lockedIds = useMemo(
    () => new Set(specs.filter((spec) => spec.locked).map((spec) => spec.id)),
    [specs],
  );
  const collisionDetection = useCallback<CollisionDetection>(
    (args) =>
      closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) => !lockedIds.has(String(c.id))),
      }),
    [lockedIds],
  );

  const announcements = useMemo<Announcements>(() => {
    const name = (id: string | number) => labelOf(String(id));
    return {
      onDragStart: ({ active }) => `Đã nhấc cột ${name(active.id)}.`,
      onDragOver: ({ active, over }) =>
        over
          ? `Cột ${name(active.id)} đang ở vị trí của cột ${name(over.id)}.`
          : `Cột ${name(active.id)} không nằm trên vị trí thả nào.`,
      onDragEnd: ({ active, over }) =>
        over
          ? `Đã thả cột ${name(active.id)} vào vị trí của cột ${name(over.id)}.`
          : `Đã thả cột ${name(active.id)}, thứ tự không đổi.`,
      onDragCancel: ({ active }) => `Đã hủy đổi chỗ cột ${name(active.id)}.`,
    };
  }, [labelOf]);

  const end = (event: DragEndEvent) => {
    document.body.classList.remove('is-col-reordering');
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  };

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={collisionDetection}
      modifiers={[restrictToHorizontalAxis]}
      accessibility={{ announcements, screenReaderInstructions: DRAG_INSTRUCTIONS }}
      onDragStart={() => document.body.classList.add('is-col-reordering')}
      onDragEnd={end}
      onDragCancel={() => document.body.classList.remove('is-col-reordering')}
    >
      <SortableContext items={ids} strategy={noShiftStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/** Chỉ cho kéo theo trục ngang (thay `@dnd-kit/modifiers`, tránh thêm gói chỉ vì một dòng). */
const restrictToHorizontalAxis: Modifier = ({ transform }) => ({ ...transform, y: 0 });

/**
 * Tay nắm kéo mép phải tiêu đề: chuột/cảm ứng (kéo), bàn phím (←/→, Shift = bước lớn), nhấp đúp = đặt lại.
 * Dừng lan truyền `pointerdown` để không kích hoạt kéo thả đổi chỗ cột của ô tiêu đề cha.
 */
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
      e.stopPropagation(); // không để dnd-kit (trên <th>) bắt sự kiện này
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
