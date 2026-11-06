import { sql, type SQL } from 'drizzle-orm';
import { type AnyPgColumn, index } from 'drizzle-orm/pg-core';

/**
 * Biểu thức tìm kiếm không dấu / không phân biệt hoa thường.
 *
 * Phụ thuộc hàm `f_search_text` (migration 0002_tim_khong_dau.sql). CHỈ ĐƯỢC SỬA biểu thức ở đây:
 * chỉ mục GIN (trong schema) và truy vấn (src/db/search.ts) cùng dùng đúng các hàm này nên
 * PostgreSQL mới chọn được chỉ mục. Có test kiểm tra (search.spec.ts).
 */

/** Hàng hóa: mã + tên. */
export const productSearchExpr = (t: {
  code: AnyPgColumn;
  name: AnyPgColumn;
}): SQL => sql`f_search_text(${t.code} || ' ' || ${t.name})`;

/** Khách hàng / nhà cung cấp: mã + tên + số điện thoại. */
export const partySearchExpr = (t: {
  code: AnyPgColumn;
  name: AnyPgColumn;
  phone: AnyPgColumn;
}): SQL =>
  sql`f_search_text(${t.code} || ' ' || ${t.name} || ' ' || coalesce(${t.phone}, ''))`;

/** Nhà cung cấp: mã + tên + nhóm (không còn số điện thoại). */
export const supplierSearchExpr = (t: {
  code: AnyPgColumn;
  name: AnyPgColumn;
  groupName: AnyPgColumn;
}): SQL =>
  sql`f_search_text(${t.code} || ' ' || ${t.name} || ' ' || coalesce(${t.groupName}, ''))`;

/** Chỉ mục GIN trigram trên một biểu thức tìm kiếm (hỗ trợ LIKE '%...%'). */
export const trgmIndex = (name: string, expr: SQL) =>
  index(name).using('gin', sql`${expr} gin_trgm_ops`);
