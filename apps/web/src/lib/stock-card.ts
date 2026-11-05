/** Nhãn và khoảng ngày mặc định cho thẻ kho (docs/api/endpoints.md mục 2.2). */

export const STOCK_REF_LABELS: Record<string, string> = {
  opening: 'Tồn đầu kỳ',
  goods_receipt: 'Nhập hàng',
  invoice: 'Bán hàng',
  sales_return: 'Khách trả hàng',
  purchase_return: 'Trả hàng nhập',
  adjustment: 'Điều chỉnh tồn',
  transfer_out: 'Chuyển kho đi',
  transfer_in: 'Nhận chuyển kho',
  transfer_cancel: 'Hủy chuyển kho',
};

export function stockRefLabel(refType: string): string {
  return STOCK_REF_LABELS[refType] ?? refType;
}

/** Ngày `YYYY-MM-DD` theo giờ Việt Nam. */
function vnDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** 30 ngày gần nhất (gồm hôm nay), theo giờ Việt Nam. */
export function defaultStockRange(now: Date = new Date()): { from: string; to: string } {
  const from = new Date(now.getTime() - 29 * 24 * 3600 * 1000);
  return { from: vnDate(from), to: vnDate(now) };
}
