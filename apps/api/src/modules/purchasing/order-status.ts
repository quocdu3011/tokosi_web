import { and, eq, inArray, sql } from 'drizzle-orm';
import { dec } from '../../common/costing.js';
import type { DbOrTx } from '../../db/database.module.js';
import {
  goodsReceiptItems,
  goodsReceipts,
  purchaseOrderItems,
  purchaseOrders,
} from '../../db/schema/index.js';
import { AppError } from '../../common/app-error.js';

/** Số đã nhập theo từng hàng của một phiếu đặt = Σ số lượng ở các phiếu nhập HOÀN TẤT gắn phiếu đặt đó. */
export async function receivedQtyByProduct(
  db: DbOrTx,
  orderId: string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({
      productId: goodsReceiptItems.productId,
      qty: sql<string>`sum(${goodsReceiptItems.qty})`,
    })
    .from(goodsReceiptItems)
    .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptItems.receiptId))
    .where(
      and(
        eq(goodsReceipts.purchaseOrderId, orderId),
        eq(goodsReceipts.status, 'completed'),
      ),
    )
    .groupBy(goodsReceiptItems.productId);
  return new Map(rows.map((r) => [r.productId, r.qty]));
}

/** Khóa phiếu đặt (FOR UPDATE) và kiểm tra thuộc chi nhánh; sai chi nhánh → 404 (không lộ là có tồn tại). */
export async function lockOrder(tx: DbOrTx, orderId: string, branchId: string) {
  const [order] = await tx
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, orderId))
    .for('update');
  if (!order || order.branchId !== branchId) {
    throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy phiếu đặt hàng nhập');
  }
  return order;
}

/**
 * Tính lại trạng thái phiếu đặt sau khi tạo/hủy phiếu nhập (gọi trong transaction, đã khóa phiếu đặt):
 * - nhập đủ mọi dòng → `completed`;
 * - chưa đủ mà phiếu đang `completed` (do tự động hoặc "Kết thúc" tay) → mở lại `confirmed`;
 * - phiếu `draft` đã có phiếu nhập → `confirmed`.
 * Phiếu đã hủy không đổi.
 */
export async function syncOrderStatus(
  tx: DbOrTx,
  orderId: string,
): Promise<void> {
  const [order] = await tx
    .select({ status: purchaseOrders.status })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, orderId));
  if (!order || order.status === 'cancelled') return;
  const items = await tx
    .select({
      productId: purchaseOrderItems.productId,
      qty: purchaseOrderItems.qty,
    })
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.orderId, orderId));
  const received = await receivedQtyByProduct(tx, orderId);
  const full = items.every((i) =>
    dec(received.get(i.productId) ?? 0).gte(dec(i.qty)),
  );
  const any = received.size > 0;
  const next =
    full && any
      ? 'completed'
      : any || order.status === 'completed'
        ? 'confirmed'
        : order.status;
  if (next !== order.status) {
    await tx
      .update(purchaseOrders)
      .set({ status: next, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, orderId));
  }
}

/** Đã nhập theo (phiếu đặt, hàng) cho nhiều phiếu đặt cùng lúc (phiếu nhập hoàn tất). */
export async function receivedByOrders(
  db: DbOrTx,
  orderIds: string[],
): Promise<Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, string>>();
  if (orderIds.length === 0) return out;
  const rows = await db
    .select({
      orderId: goodsReceipts.purchaseOrderId,
      productId: goodsReceiptItems.productId,
      qty: sql<string>`sum(${goodsReceiptItems.qty})`,
    })
    .from(goodsReceiptItems)
    .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptItems.receiptId))
    .where(
      and(
        inArray(goodsReceipts.purchaseOrderId, orderIds),
        eq(goodsReceipts.status, 'completed'),
      ),
    )
    .groupBy(goodsReceipts.purchaseOrderId, goodsReceiptItems.productId);
  for (const r of rows) {
    const m = out.get(r.orderId!) ?? new Map<string, string>();
    m.set(r.productId, r.qty);
    out.set(r.orderId!, m);
  }
  return out;
}

/**
 * "Đang đặt NCC" (`onOrder`) của từng hàng tại một chi nhánh = Σ phần CÒN PHẢI NHẬP của các phiếu đặt đang mở
 * (`draft`/`confirmed`). Hàng không có phiếu đặt không xuất hiện trong kết quả (tức 0).
 */
export async function onOrderByProduct(
  db: DbOrTx,
  branchId: string,
  productIds: string[],
): Promise<Map<string, string>> {
  if (productIds.length === 0) return new Map();
  // Chỉ các phiếu nhập hoàn tất gắn vào phiếu đặt ĐANG MỞ của chi nhánh này (không quét cả lịch sử nhập hàng)
  const rec = db
    .select({
      orderId: goodsReceipts.purchaseOrderId,
      productId: goodsReceiptItems.productId,
      qty: sql<string>`sum(${goodsReceiptItems.qty})`.as('rec_qty'),
    })
    .from(goodsReceiptItems)
    .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptItems.receiptId))
    .innerJoin(
      purchaseOrders,
      eq(purchaseOrders.id, goodsReceipts.purchaseOrderId),
    )
    .where(
      and(
        eq(goodsReceipts.status, 'completed'),
        eq(purchaseOrders.branchId, branchId),
        inArray(purchaseOrders.status, ['draft', 'confirmed']),
        inArray(goodsReceiptItems.productId, productIds),
      ),
    )
    .groupBy(goodsReceipts.purchaseOrderId, goodsReceiptItems.productId)
    .as('rec');
  const rows = await db
    .select({
      productId: purchaseOrderItems.productId,
      qty: sql<string>`sum(greatest(${purchaseOrderItems.qty} - coalesce(${rec.qty}, 0), 0))`,
    })
    .from(purchaseOrderItems)
    .innerJoin(
      purchaseOrders,
      eq(purchaseOrders.id, purchaseOrderItems.orderId),
    )
    .leftJoin(
      rec,
      and(
        eq(rec.orderId, purchaseOrders.id),
        eq(rec.productId, purchaseOrderItems.productId),
      ),
    )
    .where(
      and(
        eq(purchaseOrders.branchId, branchId),
        inArray(purchaseOrders.status, ['draft', 'confirmed']),
        inArray(purchaseOrderItems.productId, productIds),
      ),
    )
    .groupBy(purchaseOrderItems.productId);
  return new Map(rows.map((r) => [r.productId, r.qty]));
}
