import { assertNoCombo } from '../catalog/combo.js';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import {
  dec,
  roundUnitPrice,
  removeAtCost,
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
  /**
   * Chỉ khi XUẤT hàng đã nhập từ nhà cung cấp (trả hàng nhập, hủy phiếu nhập): đơn giá của số hàng rút ra. Có giá trị
   * thì giá vốn bình quân được tính lại (`removeAtCost`) và dòng sổ cái ghi đơn giá này. Bán/chuyển kho KHÔNG truyền.
   */
  reduceCostAt?: string;
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

  /**
   * Áp dụng NHIỀU dòng hàng của một chứng từ (hóa đơn, nhập hàng, chuyển kho…) trong cùng transaction.
   *
   * LUÔN dùng hàm này (không gọi `applyMovement` trong vòng lặp) khi chứng từ có từ 2 dòng trở lên: nó khóa
   * trước mọi dòng tồn theo thứ tự cố định (chi nhánh, sản phẩm) rồi mới áp dụng từng dòng theo thứ tự đầu vào.
   * Nếu khóa theo thứ tự người dùng nhập, hai chứng từ có cùng hai mặt hàng nhưng thứ tự ngược nhau (A,B và B,A)
   * chạy đồng thời sẽ chờ nhau mãi (deadlock) → PostgreSQL hủy một bên, người dùng thấy lỗi 500.
   *
   * @returns kết quả của từng dòng, đúng thứ tự đầu vào.
   */
  async applyMovements(
    tx: Tx,
    inputs: StockMovementInput[],
  ): Promise<StockMovementResult[]> {
    await assertNoCombo(tx, [...new Set(inputs.map((m) => m.productId))]);
    const keys = [
      ...new Set(inputs.map((m) => `${m.branchId}|${m.productId}`)),
    ].sort();
    for (const key of keys) {
      const [branchId, productId] = key.split('|') as [string, string];
      await this.lockStock(tx, branchId, productId);
    }
    const results: StockMovementResult[] = [];
    for (const m of inputs) results.push(await this.applyOne(tx, m));
    return results;
  }

  /** Tạo dòng tồn nếu chưa có rồi khóa nó (FOR UPDATE) cho tới hết transaction. */
  private async lockStock(tx: Tx, branchId: string, productId: string) {
    await tx
      .insert(stocks)
      .values({ branchId, productId })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(stocks)
      .where(
        and(eq(stocks.branchId, branchId), eq(stocks.productId, productId)),
      )
      .for('update');
    if (!row)
      throw new AppError(500, 'INTERNAL_ERROR', 'Không tạo được dòng tồn kho');
    return row;
  }

  /**
   * Áp dụng MỘT dòng. Chỉ gọi trực tiếp khi chứng từ chỉ có đúng một dòng; nhiều dòng thì dùng
   * `applyMovements` để tránh bế tắc.
   */
  async applyMovement(
    tx: Tx,
    m: StockMovementInput,
  ): Promise<StockMovementResult> {
    await assertNoCombo(tx, [m.productId]);
    return this.applyOne(tx, m);
  }

  /** Áp dụng một dòng (đã kiểm tra không phải combo). */
  private async applyOne(
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

    const row = await this.lockStock(tx, m.branchId, m.productId);

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
    } else if (m.reduceCostAt !== undefined) {
      movementCost = roundUnitPrice(m.reduceCostAt);
      cost = removeAtCost(
        row.onHand,
        row.costPrice,
        delta.negated(),
        movementCost,
      );
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
