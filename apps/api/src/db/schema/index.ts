/**
 * Lược đồ CSDL (Drizzle). Mỗi nhóm bảng nằm một file riêng và được xuất lại tại đây
 * (vd: `export * from './catalog.js';`). Danh sách bảng và cột: docs/TAI_LIEU_THIET_KE.md mục 5.3–5.4.
 *
 * Quy ước:
 * - Tên bảng/cột `snake_case`, tiếng Anh.
 * - Tiền chứng từ: numeric(18,0); đơn giá/giá vốn: numeric(18,4); số lượng: numeric(14,3).
 * - Không dùng float cho tiền. Chứng từ không xóa cứng (có `deleted_at`).
 */
export {};
