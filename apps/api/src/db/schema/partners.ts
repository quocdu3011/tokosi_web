import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { customerPriceLevel } from './enums.js';
import { money, pk, softDelete, timestamps, tstz } from './_helpers.js';
import { partySearchExpr, supplierSearchExpr, trgmIndex } from './_search.js';
import { branches, users } from './system.js';

/**
 * Khách hàng (theo file TKS của bộ phận kinh doanh). `salesOwnerId` = nhân viên phụ trách (cột "Sale"; ở KiotViet gọi nhầm là "Nhóm khách hàng").
 * `priceLevel` = "Level giá"; `newSince` = tháng trở thành khách mới (ngày đầu tháng; trống = khách cũ/không rõ);
 * `acquisitionSource` = nguồn khách mới ("Page"). Thông tin kho/đối thủ: `customer_profiles`; lịch tiếp khách: `customer_visits`.
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
    phone: text().unique(),
    address: text(),
    salesOwnerId: uuid().references(() => users.id),
    priceLevel: customerPriceLevel().notNull().default('new'),
    newSince: date({ mode: 'string' }),
    acquisitionSource: text(),
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

/** Hồ sơ kinh doanh của khách (cột kho/đối thủ trong file TKS); hầu hết khách không có nên tách riêng, quan hệ 1-1. */
export const customerProfiles = pgTable('customer_profiles', {
  customerId: uuid()
    .primaryKey()
    .references(() => customers.id, { onDelete: 'cascade' }),
  /** Định vị kho: đường link bản đồ, tọa độ hoặc địa chỉ chữ. */
  warehouseLocation: text(),
  warehouseCount: integer(),
  /** Diện tích kho, nhập tự do ("600m2", "ngang 6, dài 20m"). */
  warehouseArea: text(),
  /** Đường link ảnh kho (từ file TKS; ảnh tải lên sau này đi qua FileStorage). */
  warehousePhotoUrl: text(),
  competitors: text(),
  /** Hình thức bán hàng (nhiều giá trị): Bán cửa hàng, FB live, Kho buôn, Bán sàn, Sang tay, FB ads, Khác. */
  salesMethods: text().array(),
  /** "Quy mô khách" của file TKS; trống = "Chưa có". */
  scale: text(),
  updatedAt: tstz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** Lịch tiếp khách: mỗi dòng một ngày ("Các ngày tiếp khách"); "Tiếp khách lần cuối" = ngày lớn nhất, không lưu. */
export const customerVisits = pgTable(
  'customer_visits',
  {
    id: pk(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    visitedOn: date({ mode: 'string' }).notNull(),
    note: text(),
    createdBy: uuid().references(() => users.id),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [uniqueIndex('customer_visits_uq').on(t.customerId, t.visitedOn)],
);

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
    /** Nhóm nhà cung cấp (tên tự do, như "Nhóm NCC" của KiotViet). Có thể để trống; hệ thống không dựa vào nó để xử lý nghiệp vụ (kể cả nhóm "Lái xe"). */
    groupName: text(),
    linkedBranchId: uuid()
      .unique('suppliers_linked_branch_unique')
      .references(() => branches.id),
    isActive: boolean().notNull().default(true),
    createdBy: uuid().references(() => users.id),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    trgmIndex('suppliers_search_trgm', supplierSearchExpr(t)),
    // Mã không trùng kể cả khác hoa thường (cột `code` đã unique nhưng phân biệt hoa thường)
    uniqueIndex('suppliers_code_lower_unique').on(sql`lower(${t.code})`),
  ],
);

/**
 * Số liệu LỊCH SỬ mua hàng của nhà cung cấp THEO TỪNG CHI NHÁNH, chuyển từ KiotViet (chỉ công cụ chuyển dữ liệu ghi,
 * giao diện không sửa): tổng mua và tổng mua trừ trả hàng TRƯỚC khi chạy hệ thống mới. Tổng hiển thị của một chi
 * nhánh = số này + phát sinh từ phiếu nhập / trả hàng nhập của chi nhánh đó. Nợ đầu kỳ KHÔNG nằm ở đây mà là một
 * dòng `debt_ledger` loại `opening`.
 */
export const supplierBranchHistory = pgTable(
  'supplier_branch_history',
  {
    supplierId: uuid()
      .notNull()
      .references(() => suppliers.id, { onDelete: 'cascade' }),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    purchaseTotal: money().notNull().default('0'),
    purchaseNet: money().notNull().default('0'),
  },
  (t) => [primaryKey({ columns: [t.supplierId, t.branchId] })],
);
