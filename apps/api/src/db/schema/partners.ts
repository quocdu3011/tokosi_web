import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { customerType, supplierKind } from './enums.js';
import { money, pk, softDelete, timestamps } from './_helpers.js';
import { partySearchExpr, trgmIndex } from './_search.js';
import { priceBooks } from './catalog.js';
import { users } from './system.js';

/**
 * Khách hàng. `salesOwnerId` = nhân viên phụ trách (ở KiotViet gọi nhầm là "Nhóm khách hàng").
 * Công nợ KHÔNG lưu ở đây: số dư = tổng `debt_ledger` của khách (có thể âm).
 */
export const customers = pgTable(
  'customers',
  {
    id: pk(),
    code: text().notNull().unique(),
    name: text().notNull(),
    type: customerType().notNull().default('individual'),
    phone: text().unique(),
    address: text(),
    facebook: text(),
    salesOwnerId: uuid().references(() => users.id),
    defaultPriceBookId: uuid().references(() => priceBooks.id),
    creditLimit: money(),
    paymentTermDays: integer(),
    note: text(),
    isActive: boolean().notNull().default(true),
    createdBy: uuid().references(() => users.id),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    trgmIndex('customers_search_trgm', partySearchExpr(t)),
    index('customers_sales_owner_idx').on(t.salesOwnerId),
    index('customers_price_book_idx').on(t.defaultPriceBookId),
  ],
);

/** Thông tin xuất hóa đơn VAT/điện tử (MST, tên công ty…). */
export const customerInvoiceProfiles = pgTable('customer_invoice_profiles', {
  customerId: uuid()
    .primaryKey()
    .references(() => customers.id, { onDelete: 'cascade' }),
  buyerName: text(),
  companyName: text(),
  taxCode: text(),
  address: text(),
  email: text(),
  phone: text(),
  bankName: text(),
  bankAccount: text(),
});

/** Nhà cung cấp. `kind` phân biệt NCC hàng hóa với lái xe/đối tượng khác cần theo dõi công nợ. */
export const suppliers = pgTable(
  'suppliers',
  {
    id: pk(),
    code: text().notNull().unique(),
    name: text().notNull(),
    kind: supplierKind().notNull().default('goods'),
    phone: text(),
    address: text(),
    taxCode: text(),
    note: text(),
    isActive: boolean().notNull().default(true),
    createdBy: uuid().references(() => users.id),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    trgmIndex('suppliers_search_trgm', partySearchExpr(t)),
    index('suppliers_kind_idx').on(t.kind),
  ],
);
