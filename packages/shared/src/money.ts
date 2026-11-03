/**
 * Quy ước tiền tệ (xem docs/TAI_LIEU_THIET_KE.md mục 3.3 và 5.4):
 * - Tiền chứng từ: số nguyên đồng (NUMERIC(18,0) ở CSDL).
 * - Đơn giá / giá vốn: có thể lẻ, tối đa 4 chữ số thập phân (NUMERIC(18,4)).
 * - KHÔNG dùng số thực nhị phân để cộng/trừ tiền ở nghiệp vụ lõi;
 *   phần tính toán thật nằm ở backend (Decimal). Hàm dưới đây chỉ để HIỂN THỊ.
 */
const vndFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

/** Định dạng hiển thị tiền VND: 1234567 -> "1.234.567 ₫". */
export function formatVnd(amount: number): string {
  return vndFormatter.format(amount);
}
