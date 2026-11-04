import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import {
  allocateProportionally,
  dec,
  lineTotal,
  roundMoney,
  roundUnitPrice,
} from '../../common/costing.js';
import { nextDocumentCode } from '../../db/code-sequence.js';
import { DB, type Database } from '../../db/database.module.js';
import {
  branches,
  customers,
  debtLedger,
  products,
  stockTransferItems,
  stockTransfers,
  suppliers,
} from '../../db/schema/index.js';
import { InventoryService, type Tx } from '../inventory/inventory.service.js';

export interface CreateTransferInput {
  fromBranchId: string;
  toBranchId: string;
  items: Array<{ productId: string; qty: string }>;
  /** Phí vận chuyển (số nguyên đồng). Được cộng vào giá nhập kho của bên nhận. */
  shippingFee?: string;
  /** Bên ứng tiền trả xe. `sender` (mặc định): công nợ đối ứng gồm cả phí. `receiver`: chỉ gồm tiền hàng. */
  shippingPaidBy?: 'sender' | 'receiver';
  note?: string;
  sentAt?: Date;
}

export type Transfer = typeof stockTransfers.$inferSelect;
export type TransferItem = typeof stockTransferItems.$inferSelect;
export interface TransferWithItems extends Transfer {
  items: TransferItem[];
}

const TRANSFER_PREFIX = 'CH';

/**
 * Chuyển kho giữa hai chi nhánh, 2 bước:
 *  1. `create` (bên gửi): trừ tồn bên gửi theo giá vốn bên gửi, hàng "đang đi đường".
 *  2. `receive` (bên nhận): cộng tồn bên nhận với giá nhập = giá vốn bên gửi + phí vận chuyển phân bổ,
 *     cập nhật giá vốn bình quân của bên nhận, ghi công nợ đối ứng giữa hai chi nhánh.
 * Có thể `cancel` khi còn đang đi đường (trả hàng về kho bên gửi).
 *
 * Công nợ đối ứng: chi nhánh gửi coi chi nhánh nhận là KHÁCH (phải thu), chi nhánh nhận coi chi nhánh gửi
 * là NHÀ CUNG CẤP (phải trả) — dùng các khách/NCC hệ thống có `linked_branch_id`. Đây không phải hóa đơn bán
 * nên không tính vào doanh thu; báo cáo phải loại các đối tác nội bộ này.
 *
 * Việc kiểm tra người dùng có quyền ở chi nhánh gửi/nhận do tầng controller làm (BranchAccessService).
 */
@Injectable()
export class StockTransfersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly inventory: InventoryService,
  ) {}

  async create(
    input: CreateTransferInput,
    actorId: string | null = null,
  ): Promise<TransferWithItems> {
    this.validateCreate(input);
    const shippingFee = roundMoney(input.shippingFee ?? '0');

    return this.db.transaction(async (tx) => {
      await this.assertBranchesActive(tx, [
        input.fromBranchId,
        input.toBranchId,
      ]);
      await this.assertProductsExist(
        tx,
        input.items.map((i) => i.productId),
      );

      const id = randomUUID();
      const code = await nextDocumentCode(tx, TRANSFER_PREFIX);
      const sentAt = input.sentAt ?? new Date();

      // Trừ tồn bên gửi, ghi nhận giá vốn bên gửi của từng dòng
      const lines: Array<{
        productId: string;
        qty: string;
        unitCostSent: string;
        value: string;
      }> = [];
      const outQtys = input.items.map((item) => dec(item.qty).toFixed(3));
      const moved = await this.inventory.applyMovements(
        tx,
        input.items.map((item, i) => ({
          branchId: input.fromBranchId,
          productId: item.productId,
          qtyDelta: dec(outQtys[i] as string)
            .negated()
            .toFixed(3),
          refType: 'transfer_out' as const,
          refId: id,
          refCode: code,
          occurredAt: sentAt,
          userId: actorId,
        })),
      );
      input.items.forEach((item, i) => {
        const qty = outQtys[i] as string;
        const cost = (moved[i] as { movementCost: string }).movementCost;
        lines.push({
          productId: item.productId,
          qty,
          unitCostSent: cost,
          value: lineTotal(qty, cost),
        });
      });

      const goodsValue = lines.reduce((sum, l) => sum.plus(l.value), dec(0));
      const shares = allocateProportionally(
        shippingFee,
        lines.map((l) => l.value),
      );

      await tx.insert(stockTransfers).values({
        id,
        code,
        fromBranchId: input.fromBranchId,
        toBranchId: input.toBranchId,
        status: 'in_transit',
        sentAt,
        goodsValue: goodsValue.toFixed(0),
        shippingFee,
        shippingPaidBy: input.shippingPaidBy ?? 'sender',
        note: input.note ?? null,
        createdBy: actorId,
      });
      await tx.insert(stockTransferItems).values(
        lines.map((l, i) => ({
          transferId: id,
          productId: l.productId,
          qty: l.qty,
          unitCostSent: l.unitCostSent,
          shippingShare: shares[i] as string,
        })),
      );
      return this.load(tx, id);
    });
  }

  /** Bên nhận xác nhận đã nhận đủ hàng. */
  async receive(
    id: string,
    actorId: string | null = null,
    receivedAt: Date = new Date(),
  ): Promise<TransferWithItems> {
    return this.db.transaction(async (tx) => {
      const transfer = await this.lockInTransit(tx, id, 'nhận');
      const items = await tx
        .select()
        .from(stockTransferItems)
        .where(eq(stockTransferItems.transferId, id));

      // Giá nhập kho của bên nhận = giá vốn bên gửi + phí vận chuyển phân bổ trên mỗi đơn vị
      const receivedCosts = items.map((item) =>
        roundUnitPrice(
          dec(item.unitCostSent).plus(
            dec(item.shippingShare).div(dec(item.qty)),
          ),
        ),
      );
      await this.inventory.applyMovements(
        tx,
        items.map((item, i) => ({
          branchId: transfer.toBranchId,
          productId: item.productId,
          qtyDelta: dec(item.qty).toFixed(3),
          unitCost: receivedCosts[i] as string,
          refType: 'transfer_in' as const,
          refId: id,
          refCode: transfer.code,
          occurredAt: receivedAt,
          userId: actorId,
        })),
      );
      for (const [i, item] of items.entries()) {
        await tx
          .update(stockTransferItems)
          .set({ unitCostReceived: receivedCosts[i] as string })
          .where(eq(stockTransferItems.id, item.id));
      }

      // Công nợ đối ứng: tiền hàng (+ phí nếu bên gửi ứng tiền trả xe)
      const debtAmount = dec(transfer.goodsValue).plus(
        transfer.shippingPaidBy === 'sender'
          ? dec(transfer.shippingFee)
          : dec(0),
      );
      if (debtAmount.gt(0)) {
        const [receiverAsCustomer] = await tx
          .select({ id: customers.id })
          .from(customers)
          .where(eq(customers.linkedBranchId, transfer.toBranchId));
        const [senderAsSupplier] = await tx
          .select({ id: suppliers.id })
          .from(suppliers)
          .where(eq(suppliers.linkedBranchId, transfer.fromBranchId));
        if (!receiverAsCustomer || !senderAsSupplier) {
          throw new AppError(
            500,
            'INTERNAL_ERROR',
            'Chưa có khách hàng/nhà cung cấp hệ thống đại diện cho chi nhánh (chạy pnpm db:seed)',
          );
        }
        const common = {
          entryType: 'transfer' as const,
          refType: 'stock_transfer',
          refId: id,
          refCode: transfer.code,
          amount: debtAmount.toFixed(0),
          occurredAt: receivedAt,
          createdBy: actorId,
        };
        await tx.insert(debtLedger).values([
          {
            ...common,
            branchId: transfer.fromBranchId,
            partyType: 'customer',
            partyId: receiverAsCustomer.id,
          },
          {
            ...common,
            branchId: transfer.toBranchId,
            partyType: 'supplier',
            partyId: senderAsSupplier.id,
          },
        ]);
      }

      await tx
        .update(stockTransfers)
        .set({
          status: 'received',
          receivedAt,
          receivedBy: actorId,
          debtAmount: debtAmount.toFixed(0),
          updatedAt: new Date(),
        })
        .where(eq(stockTransfers.id, id));
      return this.load(tx, id);
    });
  }

  /** Hủy phiếu khi hàng còn đang đi đường: trả hàng về kho bên gửi theo đúng giá vốn lúc gửi. */
  async cancel(
    id: string,
    reason: string,
    actorId: string | null = null,
  ): Promise<TransferWithItems> {
    if (!reason.trim()) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Cần nhập lý do hủy phiếu');
    }
    return this.db.transaction(async (tx) => {
      const transfer = await this.lockInTransit(tx, id, 'hủy');
      const items = await tx
        .select()
        .from(stockTransferItems)
        .where(eq(stockTransferItems.transferId, id));
      await this.inventory.applyMovements(
        tx,
        items.map((item) => ({
          branchId: transfer.fromBranchId,
          productId: item.productId,
          qtyDelta: dec(item.qty).toFixed(3),
          unitCost: item.unitCostSent,
          refType: 'transfer_cancel' as const,
          refId: id,
          refCode: transfer.code,
          userId: actorId,
        })),
      );
      await tx
        .update(stockTransfers)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: reason.trim(),
          updatedAt: new Date(),
        })
        .where(eq(stockTransfers.id, id));
      return this.load(tx, id);
    });
  }

  async getById(id: string): Promise<TransferWithItems> {
    return this.load(this.db, id);
  }

  /**
   * Danh sách phiếu. `branchIds`: chỉ lấy phiếu mà chi nhánh gửi HOẶC nhận nằm trong danh sách
   * (truyền các chi nhánh người dùng được phép, vd từ BranchAccessService).
   */
  async list(
    filter: { branchIds?: string[]; status?: Transfer['status'] } = {},
  ): Promise<Transfer[]> {
    const conditions = [];
    if (filter.branchIds) {
      if (filter.branchIds.length === 0) return [];
      conditions.push(
        or(
          inArray(stockTransfers.fromBranchId, filter.branchIds),
          inArray(stockTransfers.toBranchId, filter.branchIds),
        ),
      );
    }
    if (filter.status)
      conditions.push(eq(stockTransfers.status, filter.status));
    return this.db
      .select()
      .from(stockTransfers)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(stockTransfers.sentAt));
  }

  // ------------------------------------------------------------------ nội bộ

  private validateCreate(input: CreateTransferInput): void {
    if (input.fromBranchId === input.toBranchId) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Chi nhánh gửi và nhận phải khác nhau',
      );
    }
    if (input.items.length === 0) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Phiếu chuyển kho cần ít nhất một mặt hàng',
      );
    }
    const seen = new Set<string>();
    for (const [i, item] of input.items.entries()) {
      if (seen.has(item.productId)) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Một mặt hàng chỉ xuất hiện một lần trong phiếu',
          {
            field: `items[${i}].productId`,
          },
        );
      }
      seen.add(item.productId);
      if (!/^\d+(\.\d{1,3})?$/.test(item.qty) || dec(item.qty).lte(0)) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Số lượng phải là số dương (tối đa 3 chữ số thập phân)',
          {
            field: `items[${i}].qty`,
          },
        );
      }
    }
    if (input.shippingFee !== undefined && !/^\d+$/.test(input.shippingFee)) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Phí vận chuyển phải là số nguyên đồng không âm',
        {
          field: 'shippingFee',
        },
      );
    }
  }

  private async assertBranchesActive(tx: Tx, ids: string[]): Promise<void> {
    const rows = await tx
      .select({ id: branches.id, isActive: branches.isActive })
      .from(branches)
      .where(inArray(branches.id, ids));
    if (rows.length !== new Set(ids).size || rows.some((r) => !r.isActive)) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Chi nhánh không tồn tại hoặc đã ngừng hoạt động',
      );
    }
  }

  private async assertProductsExist(tx: Tx, ids: string[]): Promise<void> {
    const rows = await tx
      .select({ id: products.id })
      .from(products)
      .where(inArray(products.id, ids));
    if (rows.length !== new Set(ids).size) {
      throw new AppError(404, 'NOT_FOUND', 'Có mặt hàng không tồn tại');
    }
  }

  private async lockInTransit(
    tx: Tx,
    id: string,
    action: string,
  ): Promise<Transfer> {
    const [transfer] = await tx
      .select()
      .from(stockTransfers)
      .where(eq(stockTransfers.id, id))
      .for('update');
    if (!transfer)
      throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy phiếu chuyển kho');
    if (transfer.status !== 'in_transit') {
      throw new AppError(
        400,
        'INVALID_STATE',
        `Không thể ${action} phiếu ở trạng thái "${transfer.status}" (chỉ phiếu đang đi đường)`,
        { status: transfer.status },
      );
    }
    return transfer;
  }

  private async load(
    tx: Pick<Database, 'select'>,
    id: string,
  ): Promise<TransferWithItems> {
    const [transfer] = await tx
      .select()
      .from(stockTransfers)
      .where(eq(stockTransfers.id, id));
    if (!transfer)
      throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy phiếu chuyển kho');
    const items = await tx
      .select()
      .from(stockTransferItems)
      .where(eq(stockTransferItems.transferId, id));
    return { ...transfer, items };
  }
}
