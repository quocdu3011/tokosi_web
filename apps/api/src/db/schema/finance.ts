import { sql } from 'drizzle-orm';
import {
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
  cashAccountType,
  cashDirection,
  docStatus,
  ledgerEntryType,
  partyType,
} from './enums.js';
import { cancelInfo, money, pk, timestamps, tstz } from './_helpers.js';
import { invoices } from './sales.js';
import { branches, users } from './system.js';

/** Quỹ: tiền mặt hoặc tài khoản ngân hàng. Số dư = quỹ đầu kỳ + tổng thu − tổng chi (không lưu). */
export const cashAccounts = pgTable('cash_accounts', {
  id: pk(),
  name: text().notNull(),
  type: cashAccountType().notNull(),
  branchId: uuid().references(() => branches.id),
  openingBalance: money().notNull().default('0'),
  isActive: boolean().notNull().default(true),
  ...timestamps(),
});

/** Danh mục thu chi chuẩn (thay cho chuỗi tự do của KiotViet). */
export const cashCategories = pgTable('cash_categories', {
  id: pk(),
  name: text().notNull(),
  direction: cashDirection().notNull(),
  isSystem: boolean().notNull().default(false),
  isActive: boolean().notNull().default(true),
  sortOrder: integer().notNull().default(0),
});

/**
 * Phiếu thu/chi. `amount` luôn dương, chiều thu/chi do `direction`.
 * `partyId` đa hình theo `partyType` nên không có khóa ngoại.
 */
export const cashTransactions = pgTable(
  'cash_transactions',
  {
    id: pk(),
    code: text().notNull().unique(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    direction: cashDirection().notNull(),
    amount: money().notNull(),
    categoryId: uuid()
      .notNull()
      .references(() => cashCategories.id),
    accountId: uuid()
      .notNull()
      .references(() => cashAccounts.id),
    occurredAt: tstz().notNull(),
    partyType: partyType(),
    partyId: uuid(),
    partyName: text(),
    vehicleRef: text(),
    refType: text(),
    refId: uuid(),
    status: docStatus().notNull().default('completed'),
    note: text(),
    createdBy: uuid().references(() => users.id),
    ...cancelInfo(),
    ...timestamps(),
  },
  (t) => [
    check('cash_transactions_amount_pos', sql`${t.amount} > 0`),
    index('cash_transactions_time_idx').on(t.occurredAt),
    index('cash_transactions_party_idx').on(t.partyType, t.partyId),
    index('cash_transactions_account_idx').on(t.accountId, t.occurredAt),
  ],
);

/**
 * Sổ cái công nợ: chỉ thêm. `amount` có dấu (+ tăng nợ, − giảm nợ), số dư = tổng, ĐƯỢC PHÉP ÂM.
 * `partyId` đa hình theo `partyType` (khách / NCC / nhân viên) nên không có khóa ngoại.
 */
export const debtLedger = pgTable(
  'debt_ledger',
  {
    id: pk(),
    partyType: partyType().notNull(),
    partyId: uuid().notNull(),
    entryType: ledgerEntryType().notNull(),
    refType: text(),
    refId: uuid(),
    refCode: text(),
    amount: money().notNull(),
    occurredAt: tstz().notNull(),
    note: text(),
    createdAt: tstz().notNull().defaultNow(),
    createdBy: uuid().references(() => users.id),
  },
  (t) => [
    index('debt_ledger_party_idx').on(t.partyType, t.partyId, t.occurredAt),
    index('debt_ledger_ref_idx').on(t.refType, t.refId),
    check('debt_ledger_nonzero', sql`${t.amount} <> 0`),
  ],
);

/** Cấn trừ một phiếu thu vào từng hóa đơn (phục vụ tuổi nợ và đối chiếu theo hóa đơn). */
export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    id: pk(),
    cashTransactionId: uuid()
      .notNull()
      .references(() => cashTransactions.id),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id),
    amount: money().notNull(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('payment_allocations_uq').on(t.cashTransactionId, t.invoiceId),
    index('payment_allocations_invoice_idx').on(t.invoiceId),
    check('payment_allocations_amount_pos', sql`${t.amount} > 0`),
  ],
);
