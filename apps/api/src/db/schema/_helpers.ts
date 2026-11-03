import { numeric, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Khóa chính UUID. PostgreSQL 17 chưa có uuidv7 gốc nên dùng gen_random_uuid();
 * đổi sang uuidv7() khi nâng lên PostgreSQL 18.
 */
export const pk = () => uuid().primaryKey().defaultRandom();

/** Tiền chứng từ: số nguyên đồng. API trả về dạng chuỗi (docs/api/README.md). */
export const money = () => numeric({ precision: 18, scale: 0 });

/** Đơn giá, giá bán, giá nhập, giá vốn: tối đa 4 chữ số thập phân. */
export const price = () => numeric({ precision: 18, scale: 4 });

/** Số lượng: tối đa 3 chữ số thập phân. */
export const quantity = () => numeric({ precision: 14, scale: 3 });

export const tstz = () => timestamp({ withTimezone: true });

/** Cột thời gian tạo/sửa dùng chung. */
export const timestamps = () => ({
  createdAt: tstz().notNull().defaultNow(),
  updatedAt: tstz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** Xóa mềm cho dữ liệu danh mục (chứng từ không xóa, chỉ đổi trạng thái). */
export const softDelete = () => ({ deletedAt: tstz() });

/** Thông tin hủy chứng từ (ai hủy: xem audit_logs). */
export const cancelInfo = () => ({
  cancelledAt: tstz(),
  cancelReason: text(),
});
