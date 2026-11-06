import { AppError } from './app-error.js';

const VN_OFFSET_MS = 7 * 3600 * 1000;

/**
 * 00:00 của ngày `YYYY-MM-DD` theo giờ Việt Nam (UTC+7, không có giờ mùa hè).
 * Ngày không có thật (vd 2026-02-31, 2026-13-01) → 400, không để JavaScript tự đổi sang ngày khác.
 */
export function vnDayStart(day: string, field: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const [y, mo, d] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  const utc = new Date(Date.UTC(y, mo - 1, d));
  const real =
    m !== null &&
    utc.getUTCFullYear() === y &&
    utc.getUTCMonth() === mo - 1 &&
    utc.getUTCDate() === d;
  if (!real) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Ngày không hợp lệ', [
      { field, message: 'Ngày không hợp lệ' },
    ]);
  }
  return new Date(utc.getTime() - VN_OFFSET_MS);
}

/** "dd/MM/yyyy HH:mm" theo giờ Việt Nam, dùng cho file Excel xuất ra (quy tắc: lưu UTC, hiển thị giờ Việt Nam). */
export function formatVnDateTime(date: Date | string): string {
  const v = new Date(new Date(date).getTime() + VN_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(v.getUTCDate())}/${p(v.getUTCMonth() + 1)}/${v.getUTCFullYear()} ${p(v.getUTCHours())}:${p(v.getUTCMinutes())}`;
}
