import type { ImportJob } from '@/lib/api/types';

/**
 * Nhập dữ liệu từ Excel — phần thuần (không gọi mạng) để dễ kiểm thử.
 * Hợp đồng: docs/api/endpoints.md mục 9.
 */

/** Loại dữ liệu API đang hỗ trợ (`customers`, `suppliers` còn trả `IMPORT_TYPE_NOT_SUPPORTED`). */
export type ImportType = 'products';

/**
 * - `overwrite` (Import đè): cùng khóa (mã) thì ghi thông tin trong file lên bản ghi cũ; ô trống hoặc
 *   mã không có trong file thì giữ nguyên. Cột Tồn kho/Giá vốn bị bỏ qua.
 * - `add` (Import thêm): cùng khóa thì CỘNG cột Tồn kho vào tồn của chi nhánh đang chọn (số âm = trừ),
 *   thông tin khác giữ nguyên bản cũ; mã mới được tạo. KHÔNG idempotent: chạy lại sẽ cộng thêm lần nữa.
 */
export type ImportMode = 'overwrite' | 'add';

export interface ImportTypeConfig {
  /** Tên hiển thị, dùng trong tiêu đề hộp thoại. */
  label: string;
  /** Tên file mẫu khi tải về. */
  templateFilename: string;
  /** File có cột theo chi nhánh (vị trí, tồn tối thiểu/tối đa) → bắt buộc gửi `branchId`. */
  needsBranch: boolean;
  /** Mô tả khóa so khớp, hiện ở phần giải thích chế độ. */
  keyLabel: string;
  /**
   * API đã có chế độ "Import thêm" cho loại này chưa (`?mode=add`). Loại nào chưa có thì nút bị khóa,
   * tuyệt đối không giả lập bằng cách gửi file đè vì sẽ ghi sai số liệu.
   */
  addModeSupported: boolean;
}

export const IMPORT_TYPES: Record<ImportType, ImportTypeConfig> = {
  products: {
    label: 'hàng hóa',
    templateFilename: 'mau-nhap-hang-hoa.xlsx',
    needsBranch: true,
    keyLabel: 'Mã hàng',
    addModeSupported: true,
  },
};

export const IMPORT_MODE_LABELS: Record<ImportMode, { title: string; description: string }> = {
  overwrite: {
    title: 'Import đè',
    description:
      'Cùng khóa (mã) thì thông tin trong file đè lên bản cũ. Ô trống hoặc mã không có trong file thì giữ nguyên.',
  },
  add: {
    title: 'Import thêm',
    description:
      'Cùng mã thì CỘNG cột Tồn kho vào tồn của chi nhánh đang chọn (số âm = trừ tồn); Giá vốn trong file là giá nhập của lô cộng. Thông tin khác giữ nguyên; mã mới được tạo.',
  },
};

/** Giới hạn của API: chỉ nhận `.xlsx`, tối đa 10 MB. */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

/** Trả thông báo lỗi tiếng Việt nếu file không hợp lệ, `null` nếu dùng được. */
export function validateImportFile(file: { name: string; size: number }): string | null {
  if (!/\.xlsx$/i.test(file.name)) return 'Chỉ nhận file Excel định dạng .xlsx.';
  if (file.size === 0) return 'File rỗng.';
  if (file.size > IMPORT_MAX_BYTES) return 'File lớn hơn 10 MB, hãy tách nhỏ rồi nhập từng phần.';
  return null;
}

/**
 * Chế độ có dùng được cho loại dữ liệu này không. `overwrite` luôn dùng được;
 * `add` chỉ khi API đã hỗ trợ (xem `addModeSupported`).
 */
export function isModeSupported(type: ImportType, mode: ImportMode): boolean {
  return mode === 'overwrite' || IMPORT_TYPES[type].addModeSupported;
}

export type ImportOutcome = 'ok' | 'has-errors';

/** Kết quả một lần chạy: `ok` khi không có dòng lỗi (API: có lỗi thì không ghi gì). */
export function importOutcome(job: Pick<ImportJob, 'status' | 'failed' | 'errors'>): ImportOutcome {
  return job.status === 'completed' && job.failed === 0 && job.errors.length === 0
    ? 'ok'
    : 'has-errors';
}

/** Tóm tắt một dòng: "Thêm mới 12, cập nhật 3 trên tổng 15 dòng". */
export function summarizeImport(job: Pick<ImportJob, 'created' | 'updated' | 'total'>): string {
  const n = (v: number) => v.toLocaleString('vi-VN');
  return `Thêm mới ${n(job.created)}, cập nhật ${n(job.updated)} trên tổng ${n(job.total)} dòng`;
}
