import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  docStatus,
  orderStatus,
  paymentMethod,
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

/**
 * Đặt hàng (theo file KiotViet `DanhSachChiTietDatHang`). `draft` (phiếu tạm) giữ hàng; xuất hóa đơn thì chuyển `completed`.
 * Một đơn → tối đa một hóa đơn (`invoices.order_id`). `subtotal` = Σ `line_total`, `total` = `subtotal − discount`.
 * Không lưu tiền đã trả: tiền thu nằm ở `invoice_payments`. `seller_id` (Người nhận đặt) khác `created_by` (Người tạo).
 */
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
    pickupAddress: text(),
    shipName: text(),
    shipPhone: text(),
    shipAddress: text(),
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

/** Dòng đặt hàng. `unit_price` = giá bán sau giảm; giá trước giảm = `unit_price + discount_per_unit` (không lưu, vì không có bảng giá). Một mặt hàng có thể lặp nhiều dòng trong một đơn. */
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
    discountPerUnit: price().notNull().default('0'),
    unitPrice: price().notNull(),
    lineTotal: money().notNull(),
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

/** Dòng hóa đơn (mặt hàng có thể lặp nhiều dòng); lưu bản sao mã/tên/đơn vị/giá vốn tại thời điểm bán để in lại và tính lãi gộp. */
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
    discountPerUnit: price().notNull().default('0'),
    unitPrice: price().notNull(),
    lineTotal: money().notNull(),
    unitCost: price().notNull().default('0'),
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

/** Trả hàng bán (theo file `DanhSachChiTietTraHang`). Có thể không tham chiếu hóa đơn. Tiền trả luôn ghi giảm công nợ khách (`debt_ledger`, loại `return`), không hoàn tiền trên phiếu; không có giảm giá phiếu (`total` = Σ `line_total`). */
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

/**
 * Dòng trả: `return_price` = Giá bán (tính vào công nợ khách); `restock_price` = Giá nhập lại (file KiotViet, có thể khác giá bán).
 * Hàng nhập lại kho KHÔNG đổi giá vốn bình quân; chênh lệch `(return_price − restock_price) × qty` được tính vào lợi nhuận.
 */
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
    restockPrice: price(),
    note: text(),
  },
  (t) => [
    index('sales_return_items_return_idx').on(t.returnId),
    check('sales_return_items_qty_pos', sql`${t.qty} > 0`),
  ],
);
