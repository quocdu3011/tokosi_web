import { inArray, sql } from 'drizzle-orm';
import { dec } from '../../common/costing.js';
import type { DbOrTx } from '../../db/database.module.js';
import { invoices } from '../../db/schema/index.js';

// Các biểu thức dưới đây viết tên bảng `invoices` tường minh: Drizzle bỏ tiền tố bảng của cột khi truy vấn chỉ có một
// bảng, làm `id` trong truy vấn con bị nhập nhằng. Chỉ dùng trong truy vấn `from invoices` (không đặt bí danh).

/**
 * Số khách đã cấn trừ (thu nợ về sau) vào hóa đơn: chỉ tính phiếu quỹ còn hiệu lực (`completed`); phiếu đã hủy
 * thì dòng cấn trừ vẫn nằm đó nhưng không còn tính.
 */
export const allocatedExpr = sql<string>`coalesce((
  select sum(pa.amount) from payment_allocations pa
  join cash_transactions ct on ct.id = pa.cash_transaction_id
  where pa.invoice_id = "invoices"."id" and ct.status = 'completed'
), 0)`;

/** Tổng phiếu trả hàng hoàn tất gắn hóa đơn (trả hàng giảm nợ của hóa đơn đó). */
export const returnedExpr = sql<string>`coalesce((
  select sum(sr.total) from sales_returns sr
  where sr.invoice_id = "invoices"."id" and sr.status = 'completed'
), 0)`;

/**
 * Còn nợ của hóa đơn = khách cần trả − thu lúc xuất − đã cấn trừ − phiếu trả hoàn tất gắn hóa đơn, không âm
 * (khách đã trả đủ rồi trả hàng thì phần dư nằm ở công nợ khách, không ở hóa đơn).
 */
export const outstandingExpr = sql<string>`greatest(0, "invoices"."total" - "invoices"."paid_total" - ${allocatedExpr} - ${returnedExpr})`;

export interface InvoiceBalance {
  allocated: string;
  returned: string;
  /** Còn nợ (≥ 0). */
  outstanding: string;
}

/** Số cấn trừ / đã trả hàng / còn nợ của các hóa đơn (đọc, không khóa). */
export async function balancesOf(
  db: DbOrTx,
  ids: string[],
): Promise<Map<string, InvoiceBalance>> {
  const out = new Map<string, InvoiceBalance>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      id: invoices.id,
      allocated: allocatedExpr,
      returned: returnedExpr,
      outstanding: outstandingExpr,
    })
    .from(invoices)
    .where(inArray(invoices.id, ids));
  for (const r of rows) {
    out.set(r.id, {
      allocated: dec(r.allocated).toFixed(0),
      returned: dec(r.returned).toFixed(0),
      outstanding: dec(r.outstanding).toFixed(0),
    });
  }
  return out;
}
