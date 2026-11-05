/**
 * Logic thuần của lưới giá (docs/api/endpoints.md mục 2.3). Giá bán là SỐ NGUYÊN ĐỒNG, không âm,
 * luôn là chuỗi; không đổi sang `number` để so sánh/cộng.
 */

/** Một ô đang sửa dở. Lưu cả giá gốc để so sánh được khi chuyển trang (dòng gốc không còn trên màn hình). */
export interface CellDraft {
  productId: string;
  priceBookId: string;
  /** Giá lúc tải lưới; `null` = chưa có giá. */
  original: string | null;
  /** Chuỗi người dùng đã gõ. */
  raw: string;
}

export type DraftResult =
  { kind: 'same' } | { kind: 'invalid' } | { kind: 'change'; price: string | null };

/** Server giới hạn 500 ô mỗi lần lưu. */
export const MAX_CHANGES_PER_SAVE = 500;

export function cellKey(productId: string, priceBookId: string): string {
  return `${productId}:${priceBookId}`;
}

/** Bỏ số 0 đứng đầu ("007" → "7", "000" → "0"). Chỉ gọi với chuỗi toàn chữ số. */
function stripLeadingZeros(digits: string): string {
  return digits.replace(/^0+(?=\d)/, '');
}

/**
 * So giá đã gõ với giá gốc:
 * - rỗng → xóa giá (lùi về Bảng giá chung); nếu gốc đã rỗng thì không đổi;
 * - chỉ chữ số → giá mới; trùng gốc thì không đổi;
 * - còn lại (số lẻ, âm, chữ) → không hợp lệ (server cũng từ chối).
 */
export function resolveDraft(original: string | null, raw: string): DraftResult {
  const text = raw.trim();
  if (text === '') return original === null ? { kind: 'same' } : { kind: 'change', price: null };
  if (!/^\d+$/.test(text)) return { kind: 'invalid' };
  const price = stripLeadingZeros(text);
  return price === original ? { kind: 'same' } : { kind: 'change', price };
}

export interface GridChange {
  productId: string;
  priceBookId: string;
  price: string | null;
}

export interface PendingSummary {
  changes: GridChange[];
  invalidCount: number;
}

/** Gom các ô đang sửa thành danh sách gửi `PUT /price-books/grid` (bỏ ô không đổi). */
export function summarizeDrafts(drafts: Record<string, CellDraft>): PendingSummary {
  const changes: GridChange[] = [];
  let invalidCount = 0;
  for (const d of Object.values(drafts)) {
    const r = resolveDraft(d.original, d.raw);
    if (r.kind === 'invalid') invalidCount += 1;
    else if (r.kind === 'change') {
      changes.push({ productId: d.productId, priceBookId: d.priceBookId, price: r.price });
    }
  }
  return { changes, invalidCount };
}
