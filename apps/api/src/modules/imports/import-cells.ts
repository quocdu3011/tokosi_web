import type { CellValue } from '../../common/excel.js';

/** Một lỗi của một dòng trong file nhập. `row` là số dòng trong file Excel (dòng 1 là tiêu đề). */
export interface ImportRowError {
  row: number;
  field: string;
  message: string;
}

export interface ImportOutcome {
  /** Số bản ghi sẽ được tạo / đã tạo. */
  created: number;
  /** Số bản ghi sẽ được cập nhật / đã cập nhật (có thay đổi thật). */
  updated: number;
  errors: ImportRowError[];
}

/** Lấy giá trị của cột đầu tiên có mặt trong `aliases` (tên cột đã chuẩn hóa). */
export function pick(
  values: Record<string, CellValue>,
  aliases: readonly string[],
): CellValue | undefined {
  for (const a of aliases) {
    if (a in values) return values[a];
  }
  return undefined;
}

export const hasColumn = (headers: string[], aliases: readonly string[]) =>
  aliases.some((a) => headers.includes(a));

export function asText(v: CellValue | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Số nguyên không âm từ ô (chấp nhận số hoặc chuỗi toàn chữ số); lỗi → undefined. null = ô trống. */
export function asNonNegInt(
  v: CellValue | undefined,
): number | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    return Number.isInteger(v) && v >= 0 ? v : undefined;
  }
  const s = String(v)
    .trim()
    .replace(/[.,\s]/g, '');
  return /^\d{1,15}$/.test(s) ? Number(s) : undefined;
}

/** Số thập phân không âm (tồn tối thiểu/tối đa, trọng lượng) dạng chuỗi; lỗi → undefined. null = ô trống. */
export function asNonNegDecimal(
  v: CellValue | undefined,
  maxScale: number,
): string | null | undefined {
  if (v === null || v === undefined) return null;
  const s =
    typeof v === 'number' ? String(v) : String(v).trim().replace(',', '.');
  const re = new RegExp(String.raw`^\d{1,11}(\.\d{1,${maxScale}})?$`);
  return re.test(s) ? s : undefined;
}

/** 1/0, true/false, "có"/"không" → boolean; ô trống → null; giá trị lạ → undefined. */
export function asFlag(v: CellValue | undefined): boolean | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number')
    return v === 1 ? true : v === 0 ? false : undefined;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'co', 'có', 'x'].includes(s)) return true;
  if (['0', 'false', 'khong', 'không'].includes(s)) return false;
  return undefined;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

/** Mảng PostgreSQL dạng literal `{a,b}` để truyền một tham số rồi ép kiểu. Chỉ dùng cho giá trị an toàn (mã, uuid). */
export const pgArrayLiteral = (values: string[]): string =>
  `{${values.join(',')}}`;
