import type { SortState } from '@/components/data-table/data-table';

/** Giá trị dùng để so sánh khi sắp xếp: số, chữ, hoặc trống (luôn xếp cuối, bất kể chiều). */
export type SortValue = string | number | null | undefined;

const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });

/** Chuỗi thập phân từ API → số để SO SÁNH thứ tự (không dùng để tính tiền). Trống/không hợp lệ → null. */
export function decimalSortValue(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isEmpty(v: SortValue): v is null | undefined | '' {
  return v === null || v === undefined || v === '';
}

/**
 * Sắp xếp các dòng ĐÃ TẢI VỀ (một trang) theo cột đang chọn; không đổi mảng gốc.
 * `accessors` ánh xạ id cột → giá trị so sánh; cột không có accessor thì giữ nguyên thứ tự.
 */
export function sortRows<T>(
  rows: T[],
  sort: SortState | null,
  accessors: Record<string, (row: T) => SortValue>,
): T[] {
  const get = sort ? accessors[sort.id] : undefined;
  if (!sort || !get) return rows;
  const dir = sort.desc ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index, value: get(row) }))
    .sort((a, b) => {
      const ae = isEmpty(a.value);
      const be = isEmpty(b.value);
      if (ae || be) return ae && be ? a.index - b.index : ae ? 1 : -1;
      const cmp =
        typeof a.value === 'number' && typeof b.value === 'number'
          ? a.value - b.value
          : collator.compare(String(a.value), String(b.value));
      return cmp !== 0 ? cmp * dir : a.index - b.index;
    })
    .map((x) => x.row);
}
