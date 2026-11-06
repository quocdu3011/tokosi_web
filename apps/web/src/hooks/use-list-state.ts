'use client';

import { DEFAULT_PAGE_SIZE, isPageSizeOption, type PageSizeOption } from '@kiot/shared';
import { useCallback, useMemo, useReducer, useState } from 'react';

import type { SortState } from '@/components/data-table/data-table';
import type { TablePrefsController } from '@/hooks/use-table-prefs';

import { useDebouncedValue } from './use-debounced-value';

/**
 * Trạng thái danh sách (lọc, tìm kiếm, sắp xếp, trang, cỡ trang) cho màn có bảng.
 * Quy tắc gói sẵn: đổi bộ lọc / từ khóa / sắp xếp / cỡ trang đều TỰ VỀ TRANG 1 — màn hình không còn
 * tự viết `PAGE_SIZE` và `setPage(1)`. Cỡ trang lấy từ tùy chỉnh theo tài khoản (`prefs.pageSize`).
 */

export type FilterValues = Record<string, string | number | boolean | null>;

export interface ListState<F extends FilterValues> {
  filters: F;
  q: string;
  sort: SortState | null;
  page: number;
  /** Cỡ trang cục bộ — chỉ dùng khi không nối `prefs`. */
  pageSize: PageSizeOption;
}

export type ListAction<F extends FilterValues> =
  | { type: 'filter'; key: keyof F; value: F[keyof F] }
  | { type: 'q'; value: string }
  | { type: 'sort'; sort: SortState | null }
  | { type: 'page'; page: number }
  | { type: 'pageSize'; size: PageSizeOption }
  | { type: 'reset'; state: ListState<F> };

export function initialListState<F extends FilterValues>(
  filters: F,
  sort: SortState | null = null,
): ListState<F> {
  return { filters, q: '', sort, page: 1, pageSize: DEFAULT_PAGE_SIZE };
}

/** Reducer thuần (kiểm thử được). Giá trị không đổi thì giữ nguyên trạng thái, không đẩy người dùng về trang 1. */
export function listStateReducer<F extends FilterValues>(
  state: ListState<F>,
  action: ListAction<F>,
): ListState<F> {
  switch (action.type) {
    case 'filter':
      if (state.filters[action.key] === action.value) return state;
      return { ...state, filters: { ...state.filters, [action.key]: action.value }, page: 1 };
    case 'q':
      return state.q === action.value ? state : { ...state, q: action.value, page: 1 };
    case 'sort':
      if (state.sort?.id === action.sort?.id && state.sort?.desc === action.sort?.desc)
        return state;
      return { ...state, sort: action.sort, page: 1 };
    case 'page': {
      const page = Number.isFinite(action.page) ? Math.max(1, Math.floor(action.page)) : 1;
      return page === state.page ? state : { ...state, page };
    }
    case 'pageSize':
      return { ...state, pageSize: action.size, page: 1 };
    case 'reset':
      return { ...action.state, pageSize: state.pageSize }; // giữ cỡ trang cục bộ đang chọn
  }
}

export interface UseListStateOptions<F extends FilterValues> {
  /** Giá trị bộ lọc ban đầu (cũng là giá trị `resetFilters` quay về). Nên là hằng ở mức module hoặc `useMemo`. */
  initialFilters: F;
  initialSort?: SortState | null;
  /** Nối với `useTablePrefs` để lấy/ghi cỡ trang theo tài khoản; bỏ qua = cỡ trang cục bộ (mặc định 15). */
  prefs?: Pick<TablePrefsController, 'pageSize' | 'setPageSize'>;
  /** Độ trễ gõ tìm kiếm trước khi `debouncedQ` đổi (ms). */
  debounceMs?: number;
}

export function useListState<F extends FilterValues>({
  initialFilters,
  initialSort = null,
  prefs,
  debounceMs = 300,
}: UseListStateOptions<F>) {
  const [initial] = useState(() => initialListState(initialFilters, initialSort));
  const [state, dispatch] = useReducer(listStateReducer<F>, initial);
  const debouncedQ = useDebouncedValue(state.q.trim(), debounceMs);

  const setFilter = useCallback(
    <K extends keyof F>(key: K, value: F[K]) =>
      dispatch({ type: 'filter', key, value: value as F[keyof F] }),
    [],
  );
  const setQ = useCallback((value: string) => dispatch({ type: 'q', value }), []);
  const onSortChange = useCallback(
    (sort: SortState | null) => dispatch({ type: 'sort', sort }),
    [],
  );
  const setPage = useCallback((page: number) => dispatch({ type: 'page', page }), []);
  const resetFilters = useCallback(() => dispatch({ type: 'reset', state: initial }), [initial]);

  const savePageSize = prefs?.setPageSize;
  const onPageSizeChange = useCallback(
    (size: number) => {
      if (!isPageSizeOption(size)) return;
      savePageSize?.(size);
      dispatch({ type: 'pageSize', size }); // đồng thời về trang 1
    },
    [savePageSize],
  );

  const pageSize = prefs ? prefs.pageSize : state.pageSize;

  return useMemo(
    () => ({
      filters: state.filters,
      setFilter,
      /** Từ khóa đang gõ (gắn vào ô tìm kiếm). */
      q: state.q,
      setQ,
      /** Từ khóa đã cắt khoảng trắng và trễ `debounceMs` — đưa vào tham số gọi API. */
      debouncedQ,
      sort: state.sort,
      onSortChange,
      page: state.page,
      setPage,
      pageSize,
      onPageSizeChange,
      /** Về bộ lọc/từ khóa/sắp xếp ban đầu, trang 1 (giữ nguyên cỡ trang). */
      resetFilters,
    }),
    [
      state,
      debouncedQ,
      pageSize,
      setFilter,
      setQ,
      onSortChange,
      setPage,
      onPageSizeChange,
      resetFilters,
    ],
  );
}
