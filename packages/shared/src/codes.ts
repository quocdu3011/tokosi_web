/**
 * Tiền tố mã chứng từ, giữ nguyên theo KiotViet để liên tục khi chuyển đổi
 * (docs/TAI_LIEU_THIET_KE.md mục 5.2).
 */
export const DOCUMENT_PREFIX = {
  customer: 'KH',
  supplier: 'NCC',
  order: 'DH',
  invoice: 'HD',
  salesReturn: 'TH',
  purchaseOrder: 'PDN',
  goodsReceipt: 'PN',
  purchaseReturn: 'THN',
  cashIn: 'TT',
  cashOut: 'CTM',
} as const;

export type DocumentType = keyof typeof DOCUMENT_PREFIX;

/** Số chữ số phần số của mã (KH006974 -> 6). */
export const DOCUMENT_CODE_DIGITS = 6;

/** Tiền tố mã người dùng (NV0001) — 4 chữ số. */
export const USER_CODE_PREFIX = 'NV';

/** Tạo mã từ tiền tố và số thứ tự: ("HD", 16890) -> "HD016890"; ("NV", 1, 4) -> "NV0001". */
export function formatDocumentCode(
  prefix: string,
  sequence: number,
  digits: number = DOCUMENT_CODE_DIGITS,
): string {
  return `${prefix}${String(sequence).padStart(digits, '0')}`;
}
