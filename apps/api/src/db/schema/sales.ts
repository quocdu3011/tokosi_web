import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  docStatus,
  orderStatus,
  paymentMethod,
  returnSettlement,
} from './enums.js';
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
import { cashAccounts, cashTransactions } from './finance.js';
import { customers } from './partners.js';
import { branches, users } from './system.js';

/** Đặt hàng. `draft` (phiếu tạm) giữ hàng; xuất hóa đơn thì chuyển `completed`. Một đơn → tối đa một hóa đơn. */
export const orders = pgTable(
  'orders',
  {
    id: pk(),
    code: text().notNull().unique(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    status: orderStatus().notNull().default('draft'),
    sellerId: uuid().references(() => users.id),
    orderedAt: tstz().notNull(),
    subtotal: money().notNull().default('0'),
    discount: money().notNull().default('0'),
    total: money().notNull().default('0'),
    depositAmount: money().notNull().default('0'),
    shipName: text(),
    shipPhone: text(),
    shipAddress: text(),
    packageCount: integer(),
    weightG: numeric({ precision: 12, scale: 2 }),
    note: text(),
    createdBy: uuid().references(() => users.id),
    ...cancelInfo(),
    ...timestamps(),
  },
  (t) => [
    index('orders_customer_idx').on(t.customerId, t.orderedAt),
    index('orders_status_idx').on(t.status),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: pk(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    lineNo: integer().notNull(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    qty: quantity().notNull(),
    listPrice: price().notNull(),
    discountPerUnit: price().notNull().default('0'),
    unitPrice: price().notNull(),
    lineTotal: money().notNull(),
    isGift: boolean().notNull().default(false),
    note: text(),
  },
  (t) => [
    index('order_items_order_idx').on(t.orderId),
    index('order_items_product_idx').on(t.productId),
    check('order_items_qty_pos', sql`${t.qty} > 0`),
  ],
);

/**
 * Hóa đơn bán. Không sửa sau khi tạo: hủy và tạo lại (hoặc bản sửa `.nn` ở Phase 2 qua
 * `rootInvoiceId`/`revisionNo`). `paidTotal` là số đã thu khi tạo + đã cấn trừ về sau (cache của sổ cái).
 */
export const invoices = pgTable(
  'invoices',
  {
    id: pk(),
    code: text().notNull().unique(),
    rootInvoiceId: uuid().references((): AnyPgColumn => invoices.id),
    revisionNo: integer().notNull().default(0),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    orderId: uuid()
      .unique()
      .references(() => orders.id),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    sellerId: uuid().references(() => users.id),
    invoicedAt: tstz().notNull(),
    subtotal: money().notNull(),
    discount: money().notNull().default('0'),
    total: money().notNull(),
    paidTotal: money().notNull().default('0'),
    status: docStatus().notNull().default('completed'),
    shipName: text(),
    shipPhone: text(),
    shipAddress: text(),
    note: text(),
    createdBy: uuid().references(() => users.id),
    ...cancelInfo(),
    ...timestamps(),
  },
  (t) => [
    index('invoices_customer_idx').on(t.customerId, t.invoicedAt),
    index('invoices_time_idx').on(t.invoicedAt),
    index('invoices_status_idx').on(t.status),
    uniqueIndex('invoices_root_rev_uq').on(t.rootInvoiceId, t.revisionNo),
  ],
);

/** Dòng hóa đơn; lưu bản sao mã/tên/đơn vị/giá vốn tại thời điểm bán để in lại và tính lãi gộp. */
export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: pk(),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    lineNo: integer().notNull(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    productCode: text().notNull(),
    productName: text().notNull(),
    qty: quantity().notNull(),
    listPrice: price().notNull(),
    discountPerUnit: price().notNull().default('0'),
    unitPrice: price().notNull(),
    lineTotal: money().notNull(),
    unitCost: price().notNull().default('0'),
    isGift: boolean().notNull().default(false),
    note: text(),
  },
  (t) => [
    index('invoice_items_invoice_idx').on(t.invoiceId),
    index('invoice_items_product_idx').on(t.productId),
    check('invoice_items_qty_pos', sql`${t.qty} > 0`),
  ],
);

/** Khoản thanh toán lúc xuất hóa đơn (tiền mặt / chuyển khoản). Thu nợ về sau đi qua `payment_allocations`. */
export const invoicePayments = pgTable(
  'invoice_payments',
  {
    id: pk(),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    method: paymentMethod().notNull(),
    accountId: uuid()
      .notNull()
      .references(() => cashAccounts.id),
    amount: money().notNull(),
    paidAt: tstz().notNull(),
    cashTransactionId: uuid().references(() => cashTransactions.id),
  },
  (t) => [
    index('invoice_payments_invoice_idx').on(t.invoiceId),
    check('invoice_payments_amount_pos', sql`${t.amount} > 0`),
  ],
);

/** Trả hàng bán. Có thể không tham chiếu hóa đơn. Mặc định bù trừ công nợ khách. */
export const salesReturns = pgTable(
  'sales_returns',
  {
    id: pk(),
    code: text().notNull().unique(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    invoiceId: uuid().references(() => invoices.id),
    status: docStatus().notNull().default('completed'),
    returnedAt: tstz().notNull(),
    total: money().notNull(),
    settlement: returnSettlement().notNull().default('offset_debt'),
    refundAccountId: uuid().references(() => cashAccounts.id),
    receivedBy: uuid().references(() => users.id),
    note: text(),
    createdBy: uuid().references(() => users.id),
    ...cancelInfo(),
    ...timestamps(),
  },
  (t) => [
    index('sales_returns_customer_idx').on(t.customerId, t.returnedAt),
    index('sales_returns_invoice_idx').on(t.invoiceId),
  ],
);

export const salesReturnItems = pgTable(
  'sales_return_items',
  {
    id: pk(),
    returnId: uuid()
      .notNull()
      .references(() => salesReturns.id, { onDelete: 'cascade' }),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    qty: quantity().notNull(),
    returnPrice: price().notNull(),
    lineTotal: money().notNull(),
    restock: boolean().notNull().default(true),
    restockCost: price(),
    reason: text(),
  },
  (t) => [
    index('sales_return_items_return_idx').on(t.returnId),
    check('sales_return_items_qty_pos', sql`${t.qty} > 0`),
  ],
);
