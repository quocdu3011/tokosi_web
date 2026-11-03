import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { stockRefType } from './enums.js';
import { pk, price, quantity, tstz } from './_helpers.js';
import { products } from './catalog.js';
import { branches, users } from './system.js';

/**
 * Tồn hiện tại theo chi nhánh. Chỉ được cập nhật CÙNG TRANSACTION với `stock_movements`.
 * `reserved` (khách đã đặt) và `onOrder` (đang đặt NCC) là số dẫn xuất, không lưu.
 */
export const stocks = pgTable(
  'stocks',
  {
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    onHand: quantity().notNull().default('0'),
    updatedAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.productId] }),
    check('stocks_on_hand_nonneg', sql`${t.onHand} >= 0`),
  ],
);

/** Sổ cái kho: chỉ thêm, không sửa/xóa. Phục vụ thẻ kho và đối chiếu. */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: pk(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    qtyDelta: quantity().notNull(),
    unitCost: price(),
    refType: stockRefType().notNull(),
    refId: uuid(),
    refCode: text(),
    occurredAt: tstz().notNull(),
    createdAt: tstz().notNull().defaultNow(),
    createdBy: uuid().references(() => users.id),
  },
  (t) => [
    index('stock_movements_product_time_idx').on(t.productId, t.occurredAt),
    index('stock_movements_ref_idx').on(t.refType, t.refId),
    check('stock_movements_nonzero', sql`${t.qtyDelta} <> 0`),
  ],
);
