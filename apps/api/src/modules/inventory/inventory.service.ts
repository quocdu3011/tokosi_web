import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import {
  dec,
  roundUnitPrice,
  weightedAverageCost,
} from '../../common/costing.js';
import { DB, type Database } from '../../db/database.module.js';
import { stockMovements, stocks } from '../../db/schema/index.js';

/** Transaction hoặc kết nối Drizzle (dùng chung để chạy trong transaction của chứng từ). */
export type Tx = Pick<Database, 'select' | 'insert' | 'update'>;

export type StockRefType = (typeof stockMovements.$inferInsert)['refType'];

export interface StockMovementInput {
  branchId: string;
  productId: string;
  /** Số lượng thay đổi dạng chuỗi thập phân: dương = nhập, âm = xuất. Khác 0. */
  qtyDelta: string;
  /**
   * Đơn giá của lô nhập (chỉ dùng khi nhập). Bỏ trống thì nhập theo giá vốn hiện tại (không đổi giá vốn).
   * Xuất luôn tính theo giá vốn bình quân hiện tại của chi nhánh.
   */
  unitCost?: string;
  refType: StockRefType;
  refId?: string | null;
  refCode?: string | null;
  occurredAt?: Date;
  userId?: string | null;
  /** Ghi nhận `unitCost` làm giá nhập cuối (nhập hàng từ nhà cung cấp). Chuyển kho thì không. */
  setLastPurchasePrice?: boolean;
}

export interface StockMovementResult {
  onHand: string;
  costPrice: string;
  /** Đơn giá ghi vào sổ cái: giá vốn lúc xuất, hoặc giá nhập lúc nhập. */
  movementCost: string;
}

/**
 * Cổng DUY NHẤT để thay đổi tồn kho. Mỗi lần gọi ghi một dòng sổ cái `stock_movements`, cập nhật `stocks`
 * (tồn + giá vốn bình quân của RIÊNG chi nhánh), cùng một transaction với chứng từ gốc.
 * Không bao giờ cho tồn âm.
 */
@Injectable()
export class InventoryService {
  constructor(@Inject(DB) readonly db: Database) {}

  async applyMovement(
    tx: Tx,
    m: StockMovementInput,
  ): Promise<StockMovementResult> {
    const delta = dec(m.qtyDelta);
    if (delta.isZero()) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Số lượng thay đổi phải khác 0',
      );
    }

    await tx
      .insert(stocks)
      .values({ branchId: m.branchId, productId: m.productId })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(stocks)
      .where(
        and(eq(stocks.branchId, m.branchId), eq(stocks.productId, m.productId)),
      )
      .for('update');
    if (!row)
      throw new AppError(500, 'INTERNAL_ERROR', 'Không tạo được dòng tồn kho');

    const newOnHand = dec(row.onHand).plus(delta);
    if (newOnHand.isNegative()) {
      throw new AppError(422, 'STOCK_NOT_ENOUGH', 'Không đủ tồn kho', {
        branchId: m.branchId,
        productId: m.productId,
        available: row.onHand,
        requested: delta.negated().toFixed(3),
      });
    }

    let cost = row.costPrice;
    let movementCost = row.costPrice;
    if (delta.isPositive()) {
      const inCost =
        m.unitCost === undefined ? row.costPrice : roundUnitPrice(m.unitCost);
      cost = weightedAverageCost(row.onHand, row.costPrice, delta, inCost);
      movementCost = inCost;
    }

    await tx
      .update(stocks)
      .set({
        onHand: newOnHand.toFixed(3),
        costPrice: cost,
        ...(m.setLastPurchasePrice && m.unitCost !== undefined
          ? { lastPurchasePrice: roundUnitPrice(m.unitCost) }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(eq(stocks.branchId, m.branchId), eq(stocks.productId, m.productId)),
      );

    await tx.insert(stockMovements).values({
      branchId: m.branchId,
      productId: m.productId,
      qtyDelta: delta.toFixed(3),
      unitCost: movementCost,
      refType: m.refType,
      refId: m.refId ?? null,
      refCode: m.refCode ?? null,
      occurredAt: m.occurredAt ?? new Date(),
      createdBy: m.userId ?? null,
    });

    return { onHand: newOnHand.toFixed(3), costPrice: cost, movementCost };
  }
}
