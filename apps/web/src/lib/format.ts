/**
 * Định dạng hiển thị. Tiền/giá/số lượng từ API là CHUỖI thập phân (docs/api/README.md mục 3):
 * định dạng trực tiếp trên chuỗi, không đổi sang `number` để tránh mất chính xác.
 */
const TZ = 'Asia/Ho_Chi_Minh';

const dateFmt = new Intl.DateTimeFormat('vi-VN', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const dateTimeFmt = new Intl.DateTimeFormat('vi-VN', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "2026-11-03T07:11:16.170Z" → "03/11/2026" (giờ Việt Nam). */
export function formatDate(iso: string | null | undefined): string {
  return iso ? dateFmt.format(new Date(iso)) : '';
}

/** "2026-11-03T07:11:16.170Z" → "03/11/2026 14:11" (giờ Việt Nam). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const parts = Object.fromEntries(
    dateTimeFmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

/**
 * Định dạng số thập phân dạng chuỗi theo kiểu Việt Nam: "1234567.5000" → "1.234.567,5".
 * Bỏ số 0 thừa ở phần thập phân. Chuỗi không hợp lệ trả nguyên văn.
 */
export function formatDecimal(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) return value;
  const [, sign, intPart, frac = ''] = m;
  const grouped = intPart!.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const trimmedFrac = frac.replace(/0+$/, '');
  const isZero = /^0*$/.test(intPart!) && trimmedFrac === '';
  return `${isZero ? '' : sign}${grouped}${trimmedFrac ? `,${trimmedFrac}` : ''}`;
}

/** Tiền VND từ chuỗi: "33735000" → "33.735.000 ₫". */
export function formatMoney(value: string | null | undefined): string {
  const s = formatDecimal(value);
  return s ? `${s} ₫` : '';
}
