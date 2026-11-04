/**
 * Chuẩn hóa số điện thoại Việt Nam để lưu và so trùng (dùng chung cho người dùng, khách hàng, nhà cung cấp).
 *
 * Bỏ khoảng trắng, dấu chấm, gạch ngang, ngoặc; đổi đầu số quốc tế `+84` / `84` thành `0`.
 * Kết quả hợp lệ: bắt đầu bằng `0`, tổng 10 hoặc 11 chữ số (di động 10 số; một số máy bàn 11 số).
 *
 * @returns chuỗi đã chuẩn hóa, hoặc `null` nếu không hợp lệ.
 *
 * Ví dụ: "0901 234 567" -> "0901234567"; "+84 901.234.567" -> "0901234567"; "12345" -> null.
 */
export function normalizeVnPhone(input: string): string | null {
  let digits = input.trim().replace(/[\s.\-()]/g, '');
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
  else if (/^84\d{9,10}$/.test(digits)) digits = '0' + digits.slice(2);
  return /^0\d{9,10}$/.test(digits) ? digits : null;
}
