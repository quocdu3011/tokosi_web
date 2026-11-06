/**
 * Tùy chỉnh bảng dữ liệu theo từng tài khoản (ẩn/hiện cột, thứ tự cột, độ rộng cột, số dòng mỗi trang).
 * Hợp đồng API: docs/api/endpoints.md mục 1 (`/me/table-prefs`).
 */

/** Các lựa chọn "số dòng mỗi trang" ở thanh phân trang. */
export const PAGE_SIZE_OPTIONS = [15, 50, 100] as const;
export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];
export const DEFAULT_PAGE_SIZE: PageSizeOption = 15;

export function isPageSizeOption(value: unknown): value is PageSizeOption {
  return PAGE_SIZE_OPTIONS.some((option) => option === value);
}

/** Khóa bảng: chữ thường/số, có thể có `:` `_` `-`; vd. `products`, `purchase-orders`. */
export const TABLE_KEY_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,63}$/;

/** Giới hạn dữ liệu một bảng (BE kiểm tra, FE kẹp theo). */
export const TABLE_PREFS_LIMITS = {
  maxColumns: 100,
  maxColumnIdLength: 64,
  minColumnWidth: 40,
  maxColumnWidth: 1000,
} as const;

/** Mọi trường đều tùy chọn; thiếu = dùng mặc định của màn hình. PUT thay thế toàn bộ bản ghi của bảng. */
export interface TablePrefs {
  /** Id các cột đang ẩn. */
  hidden?: string[];
  /** Thứ tự id cột (cột không có trong danh sách xếp sau, theo thứ tự mặc định). */
  order?: string[];
  /** Độ rộng (px, số nguyên) theo id cột. */
  widths?: Record<string, number>;
  /** Số dòng mỗi trang. */
  pageSize?: PageSizeOption;
}
