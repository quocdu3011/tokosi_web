import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { dec } from '../../common/costing.js';
import { AppError } from '../../common/app-error.js';
import type { Database, DbOrTx } from '../../db/database.module.js';
import {
  orderItems,
  orders,
  productComponents,
  products,
  stocks,
} from '../../db/schema/index.js';

/** Một thành phần của combo (đã nối với hàng thành phần). */
export interface ComboComponent {
  productId: string;
  code: string;
  name: string;
  qty: number;
}

/** Số liệu của combo tại MỘT chi nhánh, luôn tính từ hàng thành phần (combo không có dòng tồn riêng). */
export interface ComboFigures {
  /** Số combo ghép được từ tồn hiện có: min(⌊tồn thành phần ÷ SL trong combo⌋). */
  onHand: string;
  /** Như onHand nhưng trừ phần đang giữ cho đơn nháp; không âm. */
  available: string;
  /** Giá vốn = Σ giá vốn thành phần × SL (4 chữ số thập phân). */
  costPrice: string;
  /** Giá nhập cuối = Σ giá nhập cuối thành phần × SL; null nếu có thành phần chưa có giá nhập. */
  lastPurchasePrice: string | null;
}

/** Thành phần của các combo, theo thứ tự nhập. */
export async function loadComponents(
  db: DbOrTx,
  comboIds: string[],
): Promise<Map<string, ComboComponent[]>> {
  const map = new Map<string, ComboComponent[]>();
  if (comboIds.length === 0) return map;
  const rows = await db
    .select({
      comboId: productComponents.comboId,
      productId: products.id,
      code: products.code,
      name: products.name,
      qty: productComponents.qty,
    })
    .from(productComponents)
    .innerJoin(products, eq(products.id, productComponents.componentId))
    .where(inArray(productComponents.comboId, comboIds))
    .orderBy(asc(productComponents.sortOrder), asc(products.code));
  for (const r of rows) {
    const list = map.get(r.comboId) ?? [];
    list.push({
      productId: r.productId,
      code: r.code,
      name: r.name,
      qty: r.qty,
    });
    map.set(r.comboId, list);
  }
  return map;
}

/** Tồn / giá vốn / giá nhập cuối của các combo tại một chi nhánh. */
export async function comboFigures(
  db: DbOrTx,
  branchId: string,
  comboIds: string[],
): Promise<Map<string, ComboFigures>> {
  const result = new Map<string, ComboFigures>();
  if (comboIds.length === 0) return result;
  const components = await loadComponents(db, comboIds);
  const productIds = [
    ...new Set([...components.values()].flat().map((c) => c.productId)),
  ];
  const stockBy = new Map<
    string,
    { onHand: string; costPrice: string; lastPurchasePrice: string | null }
  >();
  const reservedBy = new Map<string, string>();
  if (productIds.length > 0) {
    const stockRows = await db
      .select()
      .from(stocks)
      .where(
        and(
          eq(stocks.branchId, branchId),
          inArray(stocks.productId, productIds),
        ),
      );
    for (const s of stockRows) stockBy.set(s.productId, s);
    const reservedRows = await db
      .select({
        productId: orderItems.productId,
        qty: sql<string>`sum(${orderItems.qty})`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(
        and(
          eq(orders.branchId, branchId),
          eq(orders.status, 'draft'),
          inArray(orderItems.productId, productIds),
        ),
      )
      .groupBy(orderItems.productId);
    for (const r of reservedRows) reservedBy.set(r.productId, r.qty);
  }

  for (const comboId of comboIds) {
    const list = components.get(comboId) ?? [];
    let onHand: ReturnType<typeof dec> | null = null;
    let available: ReturnType<typeof dec> | null = null;
    let cost = dec(0);
    let last: ReturnType<typeof dec> | null = dec(0);
    for (const c of list) {
      const s = stockBy.get(c.productId);
      const have = dec(s?.onHand ?? '0');
      const free = have.minus(dec(reservedBy.get(c.productId) ?? '0'));
      const sets = have.div(c.qty).floor();
      const freeSets = free.div(c.qty).floor();
      onHand = onHand === null || sets.lt(onHand) ? sets : onHand;
      available =
        available === null || freeSets.lt(available) ? freeSets : available;
      cost = cost.plus(dec(s?.costPrice ?? '0').times(c.qty));
      last =
        last !== null && s?.lastPurchasePrice
          ? last.plus(dec(s.lastPurchasePrice).times(c.qty))
          : null;
    }
    const nonNegative = (v: ReturnType<typeof dec> | null) =>
      (v === null || v.isNegative() ? dec(0) : v).toFixed(3);
    result.set(comboId, {
      onHand: nonNegative(onHand),
      available: nonNegative(available),
      costPrice: cost.toFixed(4),
      lastPurchasePrice: list.length > 0 && last ? last.toFixed(4) : null,
    });
  }
  return result;
}

/**
 * Biểu thức SQL: tồn "hiệu lực" của một dòng hàng tại chi nhánh. Hàng hóa lấy `stocks.on_hand`; combo lấy số combo
 * ghép được từ tồn thành phần. Dùng để lọc "còn hàng" và sắp xếp theo tồn.
 */
export function effectiveOnHandSql(branchId: string) {
  return sql`case when ${products.productType} = 'combo' then coalesce((
      select min(floor(coalesce(s.on_hand, 0) / c.qty))
      from product_components c
      left join stocks s on s.product_id = c.component_id and s.branch_id = ${branchId}
      where c.combo_id = ${products.id}
    ), 0) else coalesce(${stocks.onHand}, 0) end`;
}

/** Ném lỗi nếu có hàng là combo: combo không có tồn kho riêng, mọi biến động kho phải ghi cho hàng thành phần. */
export async function assertNoCombo(
  db: Pick<Database, 'select'>,
  productIds: string[],
): Promise<void> {
  if (productIds.length === 0) return;
  const rows = await db
    .select({ code: products.code })
    .from(products)
    .where(
      and(
        inArray(products.id, productIds),
        eq(products.productType, 'combo'),
        isNull(products.deletedAt),
      ),
    );
  if (rows.length > 0) {
    throw new AppError(
      400,
      'INVALID_STATE',
      `Combo không có tồn kho riêng, hãy dùng hàng thành phần (${rows.map((r) => r.code).join(', ')})`,
      { combos: rows.map((r) => r.code) },
    );
  }
}
