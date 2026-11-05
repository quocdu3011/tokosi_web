import { pgEnum } from 'drizzle-orm/pg-core';
import { PRODUCT_TYPES } from '@kiot/shared';

/**
 * Vai trò theo cơ cấu thực tế của công ty:
 * manager = Quản lý · assistant = Trợ lý · accountant = Kế toán · warehouse = Kho ·
 * driver = Lái xe · sales = Sale · marketing = Marketing · pending = chờ cấp quyền (tự đăng ký bằng Google).
 */
export const userRole = pgEnum('user_role', [
  'manager',
  'assistant',
  'accountant',
  'warehouse',
  'driver',
  'sales',
  'marketing',
  'pending',
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
  'transfer',
]);

export const stockRefType = pgEnum('stock_ref_type', [
  'opening',
  'goods_receipt',
  'invoice',
  'sales_return',
  'purchase_return',
  'adjustment',
  'transfer_out',
  'transfer_in',
  'transfer_cancel',
]);

/** Chế độ nhập: `overwrite` = đè thông tin theo mã; `add` = cộng thêm số lượng, giữ nguyên thông tin cũ. */
export const importMode = pgEnum('import_mode', ['overwrite', 'add']);

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

/** Phạm vi của một quyền: toàn bộ dữ liệu hoặc chỉ dữ liệu của chính người dùng. */
export const permissionScope = pgEnum('permission_scope', ['all', 'own']);

/** Phiếu chuyển kho giữa chi nhánh: đang đi đường (bên gửi đã trừ tồn) → bên nhận đã nhận / hủy. */
export const transferStatus = pgEnum('transfer_status', [
  'in_transit',
  'received',
  'cancelled',
]);

/** Ai ứng tiền trả phí vận chuyển của phiếu chuyển kho. */
export const shippingPayer = pgEnum('shipping_payer', ['sender', 'receiver']);

/** Loại hàng: goods = Hàng hóa (mặc định), combo = gói nhiều hàng hóa thành phần (không có tồn/giá vốn riêng). */
export const productType = pgEnum('product_type', PRODUCT_TYPES);
