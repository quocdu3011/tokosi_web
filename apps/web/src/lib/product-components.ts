/** Hàng thành phần của Combo: chuỗi `MSP/SL,MSP/SL` chuyển qua lại với danh sách dòng (docs/api/endpoints.md mục 2.2). */

export interface ComponentRow {
  code: string;
  qty: number;
}

/** Tách chuỗi thành các dòng. Dòng sai dạng (thiếu `/SL`) có `qty = 0` để `componentsProblem` báo lỗi. */
export function parseComponents(text: string): ComponentRow[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [code = '', qty = ''] = part.split('/').map((s) => s.trim());
      const n = /^\d+$/.test(qty) ? Number(qty) : 0;
      return { code, qty: n };
    });
}

export function serializeComponents(rows: ComponentRow[]): string {
  return rows.map((r) => `${r.code.trim()}/${r.qty}`).join(',');
}

/** Quy tắc của API: ít nhất 1 thành phần, số lượng nguyên dương, mã không lặp (không phân biệt hoa thường). */
export function componentsProblem(rows: ComponentRow[]): string | null {
  if (rows.length === 0) return 'Combo cần ít nhất một hàng thành phần';
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.code.trim()) return 'Có dòng chưa chọn hàng';
    if (!Number.isInteger(r.qty) || r.qty <= 0)
      return `Số lượng của ${r.code} phải là số nguyên dương`;
    const key = r.code.trim().toLowerCase();
    if (seen.has(key)) return `Hàng ${r.code} bị lặp`;
    seen.add(key);
  }
  return null;
}
