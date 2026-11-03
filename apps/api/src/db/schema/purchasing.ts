import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { docStatus, returnSettlement } from './enums.js';
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
import { cashAccounts } from './finance.js';
import { suppliers } from './partners.js';
import { branches, users } from './system.js';

/**
 * Phiếu nhập hàng (nhập trực tiếp). `poRef` chỉ là mã phiếu đặt nhập dạng chữ để đối chiếu
 * (module Đặt hàng nhập thuộc Phase 2). Nhập hàng cộng tồn và tính lại giá vốn bình quân.
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
    status: docStatus().notNull().default('completed'),
    receivedAt: tstz().notNull(),
    supplierInvoiceNo: text(),
    poRef: text(),
    subtotal: money().notNull(),
    discount: money().notNull().default('0'),
    total: money().notNull(),
    paidAmount: money().notNull().default('0'),
    receivedBy: uuid().references(() => users.id),
    note: text(),
    createdBy: uuid().references(() => users.id),
    ...cancelInfo(),
    ...timestamps(),
  },
  (t) => [
    index('goods_receipts_supplier_idx').on(t.supplierId, t.receivedAt),
    index('goods_receipts_time_idx').on(t.receivedAt),
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
    total: money().notNull(),
    settlement: returnSettlement().notNull().default('offset_debt'),
    refundAccountId: uuid().references(() => cashAccounts.id),
    reason: text(),
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
  },
  (t) => [
    index('purchase_return_items_return_idx').on(t.returnId),
    check('purchase_return_items_qty_pos', sql`${t.qty} > 0`),
  ],
);
