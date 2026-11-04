import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { shippingPayer, stockRefType, transferStatus } from './enums.js';
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
import { branches, users } from './system.js';

/**
 * Kho theo (chi nhánh, sản phẩm): tồn hiện tại, GIÁ VỐN BÌNH QUÂN và giá nhập cuối của riêng chi nhánh đó,
 * tồn tối thiểu/tối đa và vị trí kho. Chỉ được cập nhật CÙNG TRANSACTION với `stock_movements`.
 * `reserved` (khách đã đặt) và `onOrder` (đang đặt NCC) là số dẫn xuất, không lưu.
 */
export const stocks = pgTable(
  'stocks',
  {
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    onHand: quantity().notNull().default('0'),
    costPrice: price().notNull().default('0'),
    lastPurchasePrice: price(),
    minStock: quantity(),
    maxStock: quantity(),
    location: text(),
    updatedAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.productId] }),
    check('stocks_on_hand_nonneg', sql`${t.onHand} >= 0`),
  ],
);

/** Sổ cái kho: chỉ thêm, không sửa/xóa. Phục vụ thẻ kho và đối chiếu. */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: pk(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    qtyDelta: quantity().notNull(),
    unitCost: price(),
    refType: stockRefType().notNull(),
    refId: uuid(),
    refCode: text(),
    occurredAt: tstz().notNull(),
    createdAt: tstz().notNull().defaultNow(),
    createdBy: uuid().references(() => users.id),
  },
  (t) => [
    index('stock_movements_product_time_idx').on(t.productId, t.occurredAt),
    index('stock_movements_ref_idx').on(t.refType, t.refId),
    check('stock_movements_nonzero', sql`${t.qtyDelta} <> 0`),
  ],
);

/**
 * Phiếu chuyển kho giữa hai chi nhánh, 2 bước: bên gửi lập phiếu (trừ tồn, hàng đang đi đường) →
 * bên nhận xác nhận (cộng tồn, tính giá vốn, ghi công nợ đối ứng giữa hai chi nhánh).
 * Không phải hóa đơn bán nên KHÔNG tính vào doanh thu.
 *
 * Phí vận chuyển được phân bổ vào giá vốn nhập kho của bên nhận (giá nhập = giá vốn bên gửi + phí phân bổ)
 * và vẫn được ghi riêng ở `shipping_fee`. `shipping_paid_by` = bên ứng tiền trả xe: nếu là bên gửi thì
 * công nợ đối ứng gồm cả phí, nếu là bên nhận thì chỉ gồm tiền hàng.
 */
export const stockTransfers = pgTable(
  'stock_transfers',
  {
    id: pk(),
    code: text().notNull().unique(),
    fromBranchId: uuid()
      .notNull()
      .references(() => branches.id),
    toBranchId: uuid()
      .notNull()
      .references(() => branches.id),
    status: transferStatus().notNull().default('in_transit'),
    sentAt: tstz().notNull(),
    receivedAt: tstz(),
    /** Tổng tiền hàng theo giá vốn bên gửi tại thời điểm gửi. */
    goodsValue: money().notNull(),
    shippingFee: money().notNull().default('0'),
    shippingPaidBy: shippingPayer().notNull().default('sender'),
    /** Khoản công nợ đối ứng đã ghi khi nhận (tiền hàng + phí nếu bên gửi ứng). */
    debtAmount: money(),
    note: text(),
    createdBy: uuid().references(() => users.id),
    receivedBy: uuid().references(() => users.id),
    ...cancelInfo(),
    ...timestamps(),
  },
  (t) => [
    check(
      'stock_transfers_branches_differ',
      sql`${t.fromBranchId} <> ${t.toBranchId}`,
    ),
    check('stock_transfers_fee_nonneg', sql`${t.shippingFee} >= 0`),
    index('stock_transfers_from_idx').on(t.fromBranchId, t.sentAt),
    index('stock_transfers_to_idx').on(t.toBranchId, t.sentAt),
    index('stock_transfers_status_idx').on(t.status),
  ],
);

export const stockTransferItems = pgTable(
  'stock_transfer_items',
  {
    id: pk(),
    transferId: uuid()
      .notNull()
      .references(() => stockTransfers.id, { onDelete: 'cascade' }),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    qty: quantity().notNull(),
    /** Giá vốn bình quân của bên gửi tại thời điểm gửi. */
    unitCostSent: price().notNull(),
    /** Phần phí vận chuyển phân bổ cho dòng này (theo tỷ lệ giá trị hàng). */
    shippingShare: money().notNull().default('0'),
    /** Giá nhập kho của bên nhận = giá vốn gửi + phí phân bổ / số lượng. Có giá trị sau khi nhận. */
    unitCostReceived: price(),
  },
  (t) => [
    index('stock_transfer_items_transfer_idx').on(t.transferId),
    index('stock_transfer_items_product_idx').on(t.productId),
    check('stock_transfer_items_qty_pos', sql`${t.qty} > 0`),
  ],
);
