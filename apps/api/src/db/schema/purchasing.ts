import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { docStatus, purchaseOrderStatus } from './enums.js';
import {
  cancelInfo,
  money,
  pk,
  price,
  quantity,
  timestamps,
  tstz,
} from './_helpers.js';
import { products } from './catalog.js';
import { suppliers } from './partners.js';
import { branches, users } from './system.js';

/** Đặt hàng nhập (đặt với nhà cung cấp, chưa cộng tồn). `orderedBy` = Người đặt, `createdBy` = Người tạo. */
export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: pk(),
    code: text().notNull().unique(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    supplierId: uuid()
      .notNull()
      .references(() => suppliers.id),
    status: purchaseOrderStatus().notNull().default('draft'),
    orderedAt: tstz().notNull(),
    orderedBy: uuid().references(() => users.id),
    total: money().notNull(),
    note: text(),
    createdBy: uuid().references(() => users.id),
    ...cancelInfo(),
    ...timestamps(),
  },
  (t) => [
    index('purchase_orders_supplier_idx').on(t.supplierId, t.orderedAt),
    index('purchase_orders_branch_idx').on(t.branchId, t.orderedAt),
  ],
);

export const purchaseOrderItems = pgTable(
  'purchase_order_items',
  {
    id: pk(),
    orderId: uuid()
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    qty: quantity().notNull(),
    /** Giá nhập ("Đơn giá" trong file KiotViet luôn bằng giá nhập nên không lưu riêng); dùng tính giá vốn */
    unitCost: price().notNull(),
    lineTotal: money().notNull(),
  },
  (t) => [
    index('purchase_order_items_order_idx').on(t.orderId),
    index('purchase_order_items_product_idx').on(t.productId),
    check('purchase_order_items_qty_pos', sql`${t.qty} > 0`),
  ],
);

/**
 * Phiếu nhập hàng. `purchaseOrderId` trỏ tới phiếu đặt hàng nhập (nếu nhập theo đơn đặt).
 * Nhập hàng cộng tồn và tính lại giá vốn bình quân. Tiền trả NCC đi qua Sổ quỹ, không lưu trên phiếu.
 */
export const goodsReceipts = pgTable(
  'goods_receipts',
  {
    id: pk(),
    code: text().notNull().unique(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    supplierId: uuid()
      .notNull()
      .references(() => suppliers.id),
    purchaseOrderId: uuid().references(() => purchaseOrders.id),
    status: docStatus().notNull().default('completed'),
    receivedAt: tstz().notNull(),
    total: money().notNull(),
    receivedBy: uuid().references(() => users.id),
    note: text(),
    createdBy: uuid().references(() => users.id),
    ...cancelInfo(),
    ...timestamps(),
  },
  (t) => [
    index('goods_receipts_supplier_idx').on(t.supplierId, t.receivedAt),
    index('goods_receipts_time_idx').on(t.receivedAt),
    index('goods_receipts_po_idx').on(t.purchaseOrderId),
  ],
);

export const goodsReceiptItems = pgTable(
  'goods_receipt_items',
  {
    id: pk(),
    receiptId: uuid()
      .notNull()
      .references(() => goodsReceipts.id, { onDelete: 'cascade' }),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    qty: quantity().notNull(),
    /** Giá nhập ("Đơn giá" trong file KiotViet luôn bằng giá nhập nên không lưu riêng); dùng tính giá vốn */
    unitCost: price().notNull(),
    lineTotal: money().notNull(),
    note: text(),
  },
  (t) => [
    index('goods_receipt_items_receipt_idx').on(t.receiptId),
    index('goods_receipt_items_product_idx').on(t.productId),
    check('goods_receipt_items_qty_pos', sql`${t.qty} > 0`),
  ],
);

/** Trả hàng nhập (trả lại nhà cung cấp): trừ tồn, giảm công nợ NCC hoặc nhận tiền hoàn. */
export const purchaseReturns = pgTable(
  'purchase_returns',
  {
    id: pk(),
    code: text().notNull().unique(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    supplierId: uuid()
      .notNull()
      .references(() => suppliers.id),
    goodsReceiptId: uuid().references(() => goodsReceipts.id),
    status: docStatus().notNull().default('completed'),
    returnedAt: tstz().notNull(),
    returnedBy: uuid().references(() => users.id),
    total: money().notNull(),
    note: text(),
    createdBy: uuid().references(() => users.id),
    ...cancelInfo(),
    ...timestamps(),
  },
  (t) => [
    index('purchase_returns_supplier_idx').on(t.supplierId, t.returnedAt),
  ],
);

export const purchaseReturnItems = pgTable(
  'purchase_return_items',
  {
    id: pk(),
    returnId: uuid()
      .notNull()
      .references(() => purchaseReturns.id, { onDelete: 'cascade' }),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    qty: quantity().notNull(),
    returnPrice: price().notNull(),
    lineTotal: money().notNull(),
    note: text(),
  },
  (t) => [
    index('purchase_return_items_return_idx').on(t.returnId),
    check('purchase_return_items_qty_pos', sql`${t.qty} > 0`),
  ],
);
