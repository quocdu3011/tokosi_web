import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { customerType, supplierKind } from './enums.js';
import { money, pk, softDelete, timestamps, tstz } from './_helpers.js';
import { partySearchExpr, trgmIndex } from './_search.js';
import { branches, users } from './system.js';

/**
 * Khách hàng. `salesOwnerId` = nhân viên phụ trách (ở KiotViet gọi nhầm là "Nhóm khách hàng").
 * Công nợ KHÔNG lưu ở đây: số dư = tổng `debt_ledger` của khách THEO TỪNG CHI NHÁNH (có thể âm).
 * `linkedBranchId` có giá trị khi đây là khách hàng hệ thống đại diện cho một chi nhánh (chuyển kho nội bộ).
 * Hạn mức/kỳ hạn công nợ riêng từng chi nhánh: bảng `customer_branch_terms`.
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
    linkedBranchId: uuid()
      .unique('customers_linked_branch_unique')
      .references(() => branches.id),
    note: text(),
    isActive: boolean().notNull().default(true),
    createdBy: uuid().references(() => users.id),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    trgmIndex('customers_search_trgm', partySearchExpr(t)),
    index('customers_sales_owner_idx').on(t.salesOwnerId),
  ],
);

/** Hạn mức và kỳ hạn công nợ của một khách TẠI MỘT CHI NHÁNH (không có dòng = không giới hạn). */
export const customerBranchTerms = pgTable(
  'customer_branch_terms',
  {
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    creditLimit: money(),
    paymentTermDays: integer(),
    updatedAt: tstz().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.customerId, t.branchId] })],
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

/**
 * Nhà cung cấp. `kind` phân biệt NCC hàng hóa với lái xe/đối tượng khác cần theo dõi công nợ.
 * `linkedBranchId` có giá trị khi đây là nhà cung cấp hệ thống đại diện cho một chi nhánh (chuyển kho nội bộ).
 */
export const suppliers = pgTable(
  'suppliers',
  {
    id: pk(),
    code: text().notNull().unique(),
    name: text().notNull(),
    kind: supplierKind().notNull().default('goods'),
    /** Nhóm nhà cung cấp (tên tự do, như "Nhóm NCC" của KiotViet). Có thể để trống; hệ thống không dựa vào nó để xử lý nghiệp vụ. */
    groupName: text(),
    phone: text(),
    address: text(),
    taxCode: text(),
    linkedBranchId: uuid()
      .unique('suppliers_linked_branch_unique')
      .references(() => branches.id),
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
