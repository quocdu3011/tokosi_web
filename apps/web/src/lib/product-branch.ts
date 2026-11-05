/** Kiểm tra tồn tối thiểu/tối đa theo chi nhánh (docs/api/endpoints.md mục 2.2): số >= 0, tối đa 3 chữ số thập phân, min <= max. */

const QTY_RE = /^\d+(\.\d{1,3})?$/;

/** Chuỗi rỗng = bỏ giá trị (gửi `null`). */
export function toNullable(value: string): string | null {
  const v = value.trim();
  return v === '' ? null : v;
}

export function branchSettingsProblem(minStock: string, maxStock: string): string | null {
  const min = toNullable(minStock);
  const max = toNullable(maxStock);
  if (min !== null && !QTY_RE.test(min))
    return 'Tồn tối thiểu phải là số không âm (tối đa 3 chữ số thập phân)';
  if (max !== null && !QTY_RE.test(max))
    return 'Tồn tối đa phải là số không âm (tối đa 3 chữ số thập phân)';
  if (min !== null && max !== null && Number(min) > Number(max)) {
    return 'Tồn tối thiểu không được lớn hơn tồn tối đa';
  }
  return null;
}
