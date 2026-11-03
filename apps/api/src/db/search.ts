import { sql, type SQL } from 'drizzle-orm';

/** Thoát ký tự đặc biệt của LIKE (`\`, `%`, `_`) để người dùng gõ nguyên văn. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}

/**
 * Điều kiện tìm không dấu, không phân biệt hoa thường, theo từng từ (mọi từ đều phải có mặt).
 *
 * @param expr biểu thức đã chuẩn hóa của bảng: `productSearchExpr(products)` hoặc
 *             `partySearchExpr(customers | suppliers)` (src/db/schema/_search.ts).
 * @param q    từ khóa người dùng nhập, vd "quat kep", "Đèn lồng", "0906".
 * @returns điều kiện SQL, hoặc `undefined` nếu `q` rỗng (không lọc).
 *
 * Ví dụ:
 *   db.select().from(products).where(and(searchWhere(productSearchExpr(products), q), isNull(products.deletedAt)))
 */
export function searchWhere(
  expr: SQL,
  q: string | undefined | null,
): SQL | undefined {
  const words = (q ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  const conditions = words.map(
    (w) => sql`${expr} LIKE ('%' || f_search_text(${escapeLike(w)}) || '%')`,
  );
  return sql.join(conditions, sql` AND `);
}
