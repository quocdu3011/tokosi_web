'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';

import { columnSpecs, type ColumnLike, type ColumnSpec } from '@/components/data-table/column-meta';
import {
  mergePrefs,
  withHidden,
  withOrder,
  withPageSize,
  withWidth,
  withoutWidth,
  type ColumnWidths,
} from '@/components/data-table/prefs-core';
import { useAuthStore } from '@/lib/auth/store';
import {
  migrateLegacyPrefs,
  useAllTablePrefs,
  useResetTablePrefs,
  useSaveTablePrefs,
} from '@/lib/queries/table-prefs';
import type { PageSizeOption } from '@kiot/shared';

// Các hàm thuần để màn hình/bài kiểm thử dùng trực tiếp.
export { mergePrefs, type ResolvedPrefs } from '@/components/data-table/prefs-core';

export interface TablePrefsColumnOption {
  id: string;
  label: string;
}

/** Bộ điều khiển tùy chỉnh một bảng theo tài khoản — truyền cho `<DataTable prefs>`, `<ColumnPicker prefs>`, `useListState`. */
export interface TablePrefsController {
  tableKey: string;
  /** Id cột đang ẩn. */
  hidden: ReadonlySet<string>;
  /** Thứ tự mọi cột (kể cả cột đang ẩn). */
  order: string[];
  /** Độ rộng (px) mọi cột. */
  widths: ColumnWidths;
  pageSize: PageSizeOption;
  /** Cột cho phép ẩn/hiện (không `locked`) theo thứ tự hiện tại — dùng cho hộp "Cột". */
  columnOptions: TablePrefsColumnOption[];
  /** Có bản tùy chỉnh đã lưu cho bảng này (khác mặc định). */
  isCustomized: boolean;
  /** Đủ dữ liệu để vẽ đúng (bản sao nóng hoặc server đã trả lời); màn nên chờ cờ này trước khi gọi danh sách. */
  isReady: boolean;
  setHidden: (id: string, hidden: boolean) => void;
  /** Đổi thứ tự: các cột trong `ids` đổi chỗ cho nhau trong những ô chúng đang chiếm; cột `locked` và cột không nêu tên giữ chỗ. */
  setOrder: (ids: string[]) => void;
  setWidth: (id: string, px: number) => void;
  resetWidth: (id: string) => void;
  /** Giá trị ngoài `PAGE_SIZE_OPTIONS` (15/50/100) bị bỏ qua. */
  setPageSize: (size: number) => void;
  /** Đặt lại ẩn/thứ tự/độ rộng/số dòng mỗi trang về mặc định (xóa bản ghi trên server). */
  reset: () => void;
}

/**
 * Tùy chỉnh bảng của MỘT bảng, lưu theo tài khoản trên server (`/me/table-prefs`).
 *
 * - `tableKey`: khóa bảng ổn định, vd. `products`, `purchase-orders` (chữ thường/số/`:`/`_`/`-`, ≤ 64 ký tự).
 * - `columns`: mô tả cột của bảng (gắn `meta` — xem `TableColumnMeta`); id/nhãn/độ rộng mặc định/cột ẩn mặc định suy ra từ đó.
 *   Có thể là mảng tạo mới mỗi lần vẽ: hook chỉ xét lại khi nội dung mô tả thật sự đổi.
 *
 * Chưa đăng nhập hoặc server lỗi: vẫn trả mặc định (+ bản sao nóng nếu có), thao tác chỉ áp dụng trong phiên.
 */
export function useTablePrefs(
  tableKey: string,
  columns: readonly ColumnLike[],
): TablePrefsController {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { tables, isReady, isServerLoaded } = useAllTablePrefs();
  const { save, flush } = useSaveTablePrefs();
  const resetTable = useResetTablePrefs();

  // Mô tả cột ổn định theo nội dung (mảng `columns` thường được tạo mới mỗi lần vẽ).
  const signature = JSON.stringify(columnSpecs(columns));
  const specs = useMemo(() => JSON.parse(signature) as ColumnSpec[], [signature]);

  const saved = tables[tableKey];
  const merged = useMemo(() => mergePrefs(specs, saved), [specs, saved]);

  // Giữ nguyên tham chiếu `hidden`/`order` khi nội dung không đổi (kéo mép cột không làm bảng dựng lại cột).
  const hiddenSignature = JSON.stringify([...merged.hidden]);
  const hidden = useMemo(() => new Set(JSON.parse(hiddenSignature) as string[]), [hiddenSignature]);
  const orderSignature = JSON.stringify(merged.order);
  const order = useMemo(() => JSON.parse(orderSignature) as string[], [orderSignature]);

  const columnOptions = useMemo(() => {
    const byId = new Map(specs.map((spec) => [spec.id, spec]));
    return order.flatMap((id) => {
      const spec = byId.get(id);
      return spec && !spec.locked ? [{ id, label: spec.label }] : [];
    });
  }, [order, specs]);

  // Chuyển một lần tùy chỉnh cũ (localStorage) lên server khi server chưa có gì cho bảng này.
  useEffect(() => {
    if (!userId || !isServerLoaded || saved !== undefined) return;
    migrateLegacyPrefs(qc, userId, tableKey, specs);
  }, [qc, userId, isServerLoaded, saved, tableKey, specs]);

  // Rời màn hình khi còn thay đổi đang chờ gửi (debounce) thì gửi luôn.
  useEffect(() => () => flush(tableKey), [flush, tableKey]);

  const setHidden = useCallback(
    (id: string, hide: boolean) => save(tableKey, (cur) => withHidden(specs, cur, id, hide)),
    [save, tableKey, specs],
  );
  const setOrder = useCallback(
    (ids: string[]) => save(tableKey, (cur) => withOrder(specs, cur, ids)),
    [save, tableKey, specs],
  );
  const setWidth = useCallback(
    (id: string, px: number) => save(tableKey, (cur) => withWidth(cur, id, px)),
    [save, tableKey],
  );
  const resetWidth = useCallback(
    (id: string) => save(tableKey, (cur) => withoutWidth(cur, id)),
    [save, tableKey],
  );
  const setPageSize = useCallback(
    (size: number) => save(tableKey, (cur) => withPageSize(cur, size)),
    [save, tableKey],
  );
  const reset = useCallback(() => resetTable(tableKey), [resetTable, tableKey]);

  return useMemo(
    () => ({
      tableKey,
      hidden,
      order,
      widths: merged.widths,
      pageSize: merged.pageSize,
      columnOptions,
      isCustomized: saved !== undefined,
      isReady,
      setHidden,
      setOrder,
      setWidth,
      resetWidth,
      setPageSize,
      reset,
    }),
    [
      tableKey,
      hidden,
      order,
      merged.widths,
      merged.pageSize,
      columnOptions,
      saved,
      isReady,
      setHidden,
      setOrder,
      setWidth,
      resetWidth,
      setPageSize,
      reset,
    ],
  );
}
