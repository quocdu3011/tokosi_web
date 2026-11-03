import { pgEnum } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', [
  'owner',
  'accountant',
  'warehouse',
  'clerk',
]);
export const customerType = pgEnum('customer_type', ['individual', 'company']);
export const supplierKind = pgEnum('supplier_kind', [
  'goods',
  'driver',
  'other',
]);

/** Đơn đặt hàng: phiếu tạm → đã xuất hóa đơn / hủy. */
export const orderStatus = pgEnum('order_status', [
  'draft',
  'completed',
  'cancelled',
]);
/** Hóa đơn, phiếu nhập, phiếu trả, phiếu thu chi: hoàn thành / hủy (không xóa). */
export const docStatus = pgEnum('doc_status', ['completed', 'cancelled']);

export const paymentMethod = pgEnum('payment_method', ['cash', 'bank']);
export const cashAccountType = pgEnum('cash_account_type', ['cash', 'bank']);
export const cashDirection = pgEnum('cash_direction', ['in', 'out']);
export const partyType = pgEnum('party_type', [
  'customer',
  'supplier',
  'employee',
]);
export const returnSettlement = pgEnum('return_settlement', [
  'offset_debt',
  'refund',
]);

export const ledgerEntryType = pgEnum('ledger_entry_type', [
  'opening',
  'invoice',
  'payment',
  'return',
  'adjustment',
]);

export const stockRefType = pgEnum('stock_ref_type', [
  'opening',
  'goods_receipt',
  'invoice',
  'sales_return',
  'purchase_return',
  'adjustment',
]);

export const importType = pgEnum('import_type', [
  'products',
  'customers',
  'suppliers',
  'price-books',
]);
export const importStatus = pgEnum('import_status', [
  'queued',
  'running',
  'completed',
  'failed',
]);
