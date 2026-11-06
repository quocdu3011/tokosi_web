/**
 * Mô tả cột gom một chỗ, gắn vào `meta` của ColumnDef (TanStack Table v9: khe kiểu `columnMeta`
 * của `tableFeatures`, xem data-table.tsx). Từ đây suy ra nhãn hộp "Cột", nhãn trợ năng của tay
 * nắm kéo, độ rộng mặc định, cột ẩn mặc định, cột sắp xếp được và gợi ý sắp xếp — màn hình
 * không phải khai báo lặp PICKER_LABELS / DEFAULT_WIDTHS / DEFAULT_HIDDEN / SORTABLE_IDS nữa.
 *
 * File thuần (không React) để kiểm thử được trong môi trường Node.
 */

export interface TableColumnMeta {
  /** Tên cột hiển thị trong hộp "Cột" và nhãn trợ năng (viết hoa chữ đầu, vd. `Giá vốn`). */
  label: string;
  /** Độ rộng mặc định (px); thiếu = 160. */
  width?: number;
  /** Cột phụ: mặc định ẩn, người dùng bật ở nút "Cột". */
  hiddenByDefault?: boolean;
  /** Không ẩn được, không kéo đổi chỗ (vd. Mã hàng, Thao tác); giữ nguyên vị trí mặc định. */
  locked?: boolean;
  /** `server`: server sắp xếp trên toàn bộ kết quả; `page`: chỉ sắp xếp trong trang đang xem. Thiếu = không sắp xếp. */
  sort?: 'server' | 'page';
  /** Gợi ý (tooltip) riêng cho nút sắp xếp; mặc định của cột `page` là {@link PAGE_SORT_HINT}. */
  sortHint?: string;
}

export const DEFAULT_COLUMN_WIDTH = 160;
export const PAGE_SORT_HINT = 'Sắp xếp trong trang đang xem';

/** Dạng đã chuẩn hóa của một cột (đủ giá trị mặc định) — đầu vào của `mergePrefs`. */
export interface ColumnSpec {
  id: string;
  label: string;
  width: number;
  hiddenByDefault: boolean;
  locked: boolean;
}

/** Phần tối thiểu của ColumnDef mà các hàm ở đây cần (ColumnDef của TanStack gán vào được). */
export interface ColumnLike {
  id?: string;
  meta?: TableColumnMeta;
}

/** Chuẩn hóa danh sách cột (theo thứ tự khai báo). Cột không có `id` hoặc trùng `id` bị bỏ qua. */
export function columnSpecs(columns: readonly ColumnLike[]): ColumnSpec[] {
  const seen = new Set<string>();
  const specs: ColumnSpec[] = [];
  for (const column of columns) {
    const id = column.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const meta = column.meta;
    specs.push({
      id,
      label: meta?.label ?? id,
      width: meta?.width ?? DEFAULT_COLUMN_WIDTH,
      hiddenByDefault: meta?.hiddenByDefault === true,
      locked: meta?.locked === true,
    });
  }
  return specs;
}

/** Id các cột sắp xếp được: `kind` thiếu = mọi cột có `meta.sort`; hoặc chỉ `server` / `page`. */
export function sortableIdsOf(
  columns: readonly ColumnLike[],
  kind?: NonNullable<TableColumnMeta['sort']>,
): string[] {
  const ids: string[] = [];
  for (const column of columns) {
    const sort = column.meta?.sort;
    if (column.id && sort && (kind === undefined || sort === kind)) ids.push(column.id);
  }
  return ids;
}

/** Gợi ý sắp xếp theo id cột: `meta.sortHint`, hoặc {@link PAGE_SORT_HINT} cho cột chỉ sắp xếp trong trang. */
export function sortHintsOf(columns: readonly ColumnLike[]): Record<string, string> {
  const hints: Record<string, string> = {};
  for (const column of columns) {
    if (!column.id || !column.meta) continue;
    const hint = column.meta.sortHint ?? (column.meta.sort === 'page' ? PAGE_SORT_HINT : undefined);
    if (hint) hints[column.id] = hint;
  }
  return hints;
}
