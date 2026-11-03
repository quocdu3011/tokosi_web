/**
 * Lược đồ CSDL (Drizzle) — NGUỒN SỰ THẬT. Mô tả tổng quan, sơ đồ và cách xem: docs/db/README.md.
 *
 * Quy ước:
 * - Tên bảng/cột `snake_case` tiếng Anh (khai báo camelCase, Drizzle tự đổi: `casing: 'snake_case'`).
 * - Tiền chứng từ numeric(18,0); đơn giá/giá vốn numeric(18,4); số lượng numeric(14,3). Không dùng float.
 * - Chứng từ không xóa cứng (đổi `status`); danh mục dùng `deleted_at`.
 * - Sổ cái (`stock_movements`, `debt_ledger`) chỉ thêm; tồn/số dư không sửa trực tiếp.
 */
export * from './enums.js';
export * from './system.js';
export * from './catalog.js';
export * from './partners.js';
export * from './inventory.js';
export * from './sales.js';
export * from './purchasing.js';
export * from './finance.js';
