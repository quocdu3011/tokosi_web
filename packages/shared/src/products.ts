/** Loại hàng: Hàng hóa (mặc định) hoặc Combo (gói nhiều hàng hóa thành phần, chỉ để chọn nhanh). */
export const PRODUCT_TYPES = ['goods', 'combo'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];
export const DEFAULT_PRODUCT_TYPE: ProductType = 'goods';

export interface ComponentEntry {
  /** Mã hàng thành phần (giữ nguyên chữ hoa/thường người nhập). */
  code: string;
  /** Số lượng nguyên dương trong MỘT combo. */
  qty: number;
}

/** Số lượng tối đa của một thành phần trong một combo. */
export const MAX_COMPONENT_QTY = 100_000;

export type ParseComponentsResult =
  | { ok: true; items: ComponentEntry[] }
  | { ok: false; error: string };

/**
 * Đọc chuỗi "Hàng thành phần" dạng `MSP/SL,MSP/SL` (vd `DAO01/2,KEO03/1`).
 * Chuỗi rỗng → danh sách rỗng. Lỗi: sai cú pháp, số lượng không phải số nguyên dương, mã trùng nhau.
 */
export function parseComponents(text: string): ParseComponentsResult {
  const raw = text.trim();
  if (raw === '') return { ok: true, items: [] };
  const items: ComponentEntry[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const piece = part.trim();
    const slash = piece.lastIndexOf('/');
    if (slash <= 0 || slash === piece.length - 1) {
      return {
        ok: false,
        error: `"${piece}" sai dạng, cần MÃ/SỐ LƯỢNG (vd DAO01/2)`,
      };
    }
    const code = piece.slice(0, slash).trim();
    const qtyText = piece.slice(slash + 1).trim();
    if (code === '') return { ok: false, error: `"${piece}" thiếu mã hàng` };
    if (!/^[1-9]\d{0,5}$/.test(qtyText)) {
      return {
        ok: false,
        error: `Số lượng của "${code}" phải là số nguyên dương (đã nhận "${qtyText}")`,
      };
    }
    const qty = Number(qtyText);
    if (qty > MAX_COMPONENT_QTY) {
      return {
        ok: false,
        error: `Số lượng của "${code}" vượt quá ${MAX_COMPONENT_QTY}`,
      };
    }
    const key = code.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, error: `Mã "${code}" bị lặp trong cùng combo` };
    }
    seen.add(key);
    items.push({ code, qty });
  }
  return { ok: true, items };
}

/** Ngược lại của `parseComponents`: [{DAO01,2},{KEO03,1}] → "DAO01/2,KEO03/1". */
export function formatComponents(items: readonly ComponentEntry[]): string {
  return items.map((i) => `${i.code}/${i.qty}`).join(',');
}
