import { Inject, Injectable } from '@nestjs/common';
import { DOCUMENT_PREFIX } from '@kiot/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lt,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AppError } from '../../common/app-error.js';
import type { AuthUser } from '../../common/auth-user.js';
import { dec } from '../../common/costing.js';
import { lockPartyBranch } from '../../common/advisory-lock.js';
import { writeSheet, type CellValue } from '../../common/excel.js';
import { pageMeta, pageParams, parseSort } from '../../common/pagination.js';
import { formatVnDateTime } from '../../common/vn-date.js';
import { nextFreeDocumentCode } from '../../db/code-sequence.js';
import { DB, type Database } from '../../db/database.module.js';
import {
  branches,
  debtLedger,
  goodsReceiptItems,
  goodsReceipts,
  products,
  purchaseOrders,
  purchaseReturnItems,
  purchaseReturns,
  suppliers,
  users,
} from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { lockOrder, syncOrderStatus } from './order-status.js';
import {
  dayRange,
  docSearch,
  loadLineProducts,
  loadSupplier,
  notFound,
  priceLines,
  resolvePerson,
  resolveTime,
  summarizeLines,
} from './purchase-lines.js';
import {
  RECEIPT_SORT_FIELDS,
  type CreateGoodsReceiptDto,
  type GoodsReceiptDto,
  type ListGoodsReceiptsQueryDto,
} from './purchasing.dto.js';

export const DOC_EXPORT_MAX_ROWS = 10_000;
const RECEIPT_LABEL = {
  completed: 'Đã nhập hàng',
  cancelled: 'Đã hủy',
} as const;

const rcv = alias(users, 'receiver');
const crt = alias(users, 'creator');

/** Phiếu nhập hàng: cộng tồn + tính lại giá vốn bình quân của chi nhánh + ghi nợ nhà cung cấp, cùng một transaction. */
@Injectable()
export class GoodsReceiptsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly auditLog: AuditService,
    private readonly inventory: InventoryService,
  ) {}

  async list(
    branchId: string,
    q: ListGoodsReceiptsQueryDto,
    mode: 'page' | 'export' = 'page',
  ) {
    const { start, endExclusive } = dayRange(q.from, q.to);
    const where = and(
      eq(goodsReceipts.branchId, branchId),
      docSearch(goodsReceipts.code, suppliers.code, suppliers.name, q.q),
      q.supplierId ? eq(goodsReceipts.supplierId, q.supplierId) : undefined,
      q.purchaseOrderId
        ? eq(goodsReceipts.purchaseOrderId, q.purchaseOrderId)
        : undefined,
      q.status ? eq(goodsReceipts.status, q.status) : undefined,
      start ? gte(goodsReceipts.receivedAt, start) : undefined,
      endExclusive ? lt(goodsReceipts.receivedAt, endExclusive) : undefined,
    );
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(goodsReceipts)
      .innerJoin(suppliers, eq(suppliers.id, goodsReceipts.supplierId))
      .where(where);

    const sort = parseSort(q.sort, RECEIPT_SORT_FIELDS);
    const dir = sort?.desc === false ? asc : desc;
    const sortCol =
      sort?.field === 'code'
        ? goodsReceipts.code
        : sort?.field === 'total'
          ? goodsReceipts.total
          : goodsReceipts.receivedAt;
    const { page, limit, offset } =
      mode === 'export'
        ? { page: 1, limit: DOC_EXPORT_MAX_ROWS, offset: 0 }
        : pageParams(q);
    const rows = await this.headers(where)
      .orderBy(dir(sortCol), desc(goodsReceipts.id))
      .limit(limit)
      .offset(offset);
    const items = await this.itemsOf(rows.map((r) => r.r.id));
    return {
      data: rows.map((r) => this.toDto(r, items.get(r.r.id) ?? [], false)),
      meta: pageMeta(page, limit, total),
      itemsById: items,
    };
  }

  async get(branchId: string, id: string): Promise<GoodsReceiptDto> {
    const [row] = await this.headers(
      and(eq(goodsReceipts.id, id), eq(goodsReceipts.branchId, branchId)),
    );
    if (!row) throw notFound('phiếu nhập hàng');
    const items = await this.itemsOf([id]);
    return this.toDto(row, items.get(id) ?? [], true);
  }

  async create(
    user: AuthUser,
    branchId: string,
    input: CreateGoodsReceiptDto,
  ): Promise<GoodsReceiptDto> {
    const receivedAt = resolveTime(input.receivedAt, 'receivedAt');
    const id = await this.db.transaction(async (tx) => {
      // Công nợ NCC: khóa theo (NCC, chi nhánh) ĐẦU TIÊN, trước mọi thao tác ghi.
      await lockPartyBranch(tx, 'supplier', input.supplierId, branchId);
      await loadSupplier(tx, input.supplierId, true);
      const receiver = await resolvePerson(
        tx,
        input.receivedById,
        user.id,
        branchId,
        'receivedById',
      );
      const { lines, total } = priceLines(
        input.items.map((i) => ({
          productId: i.productId,
          qty: i.qty,
          price: i.unitCost,
        })),
      );
      await loadLineProducts(
        tx,
        lines.map((l) => l.productId),
        true,
      );

      if (input.purchaseOrderId) {
        const order = await lockOrder(tx, input.purchaseOrderId, branchId);
        if (order.supplierId !== input.supplierId) {
          throw new AppError(
            400,
            'VALIDATION_ERROR',
            'Phiếu đặt hàng nhập thuộc nhà cung cấp khác',
            [
              {
                field: 'purchaseOrderId',
                message: 'Khác nhà cung cấp của phiếu nhập',
              },
            ],
          );
        }
        if (order.status !== 'draft' && order.status !== 'confirmed') {
          throw new AppError(
            422,
            'INVALID_STATE',
            'Phiếu đặt hàng nhập đã hoàn thành hoặc đã hủy, không nhập thêm được',
          );
        }
      }

      const code = await nextFreeDocumentCode(
        tx,
        DOCUMENT_PREFIX.goodsReceipt,
        async (c) => {
          const [hit] = await tx
            .select({ id: goodsReceipts.id })
            .from(goodsReceipts)
            .where(sql`lower(${goodsReceipts.code}) = lower(${c})`);
          return hit !== undefined;
        },
      );
      const [receipt] = await tx
        .insert(goodsReceipts)
        .values({
          code,
          branchId,
          supplierId: input.supplierId,
          purchaseOrderId: input.purchaseOrderId ?? null,
          receivedAt,
          total,
          receivedBy: receiver,
          note: input.note?.trim() || null,
          createdBy: user.id,
        })
        .returning();
      await tx.insert(goodsReceiptItems).values(
        lines.map((l) => ({
          receiptId: receipt!.id,
          productId: l.productId,
          qty: l.qty,
          unitCost: l.price,
          lineTotal: l.lineTotal,
        })),
      );

      // Kho: cộng tồn + giá vốn bình quân (applyMovements khóa theo thứ tự cố định → không bế tắc).
      await this.inventory.applyMovements(
        tx,
        lines.map((l) => ({
          branchId,
          productId: l.productId,
          qtyDelta: l.qty,
          unitCost: l.price,
          refType: 'goods_receipt' as const,
          refId: receipt!.id,
          refCode: code,
          occurredAt: receivedAt,
          userId: user.id,
          setLastPurchasePrice: true,
        })),
      );
      if (dec(total).gt(0)) {
        await tx.insert(debtLedger).values({
          branchId,
          partyType: 'supplier',
          partyId: input.supplierId,
          entryType: 'invoice',
          refType: 'goods_receipt',
          refId: receipt!.id,
          refCode: code,
          amount: total,
          occurredAt: receivedAt,
          createdBy: user.id,
        });
      }
      if (input.purchaseOrderId) {
        await syncOrderStatus(tx, input.purchaseOrderId);
      }
      await this.auditLog.record(tx, {
        action: 'goods_receipt.create',
        entityType: 'goods_receipt',
        entityId: receipt!.id,
        after: {
          code,
          supplierId: input.supplierId,
          total,
          items: lines.length,
        },
      });
      return receipt!.id;
    });
    return this.get(branchId, id);
  }

  async updateNote(
    branchId: string,
    id: string,
    note: string | null,
  ): Promise<GoodsReceiptDto> {
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(goodsReceipts)
        .where(
          and(eq(goodsReceipts.id, id), eq(goodsReceipts.branchId, branchId)),
        );
      if (!before) throw notFound('phiếu nhập hàng');
      const next = note?.trim() || null;
      await tx
        .update(goodsReceipts)
        .set({ note: next, updatedAt: new Date() })
        .where(eq(goodsReceipts.id, id));
      await this.auditLog.record(tx, {
        action: 'goods_receipt.update_note',
        entityType: 'goods_receipt',
        entityId: id,
        before: { note: before.note },
        after: { note: next },
      });
    });
    return this.get(branchId, id);
  }

  /** Hủy phiếu: bút toán đảo kho (+ giá vốn tính ngược) và công nợ. Hàng đã bán hết/đã trả NCC thì không hủy được. */
  async cancel(
    user: AuthUser,
    branchId: string,
    id: string,
    reason: string | undefined,
  ): Promise<GoodsReceiptDto> {
    const [pre] = await this.db
      .select({ supplierId: goodsReceipts.supplierId })
      .from(goodsReceipts)
      .where(
        and(eq(goodsReceipts.id, id), eq(goodsReceipts.branchId, branchId)),
      );
    if (!pre) throw notFound('phiếu nhập hàng');

    await this.db.transaction(async (tx) => {
      await lockPartyBranch(tx, 'supplier', pre.supplierId, branchId);
      const [receipt] = await tx
        .select()
        .from(goodsReceipts)
        .where(eq(goodsReceipts.id, id))
        .for('update');
      if (!receipt) throw notFound('phiếu nhập hàng');
      if (receipt.status !== 'completed') {
        throw new AppError(422, 'INVALID_STATE', 'Phiếu nhập đã hủy');
      }
      const [returned] = await tx
        .select({ id: purchaseReturns.id })
        .from(purchaseReturns)
        .where(
          and(
            eq(purchaseReturns.goodsReceiptId, id),
            eq(purchaseReturns.status, 'completed'),
          ),
        )
        .limit(1);
      if (returned) {
        throw new AppError(
          409,
          'INVALID_STATE',
          'Phiếu nhập đã có phiếu trả hàng nhập, hãy hủy phiếu trả trước',
        );
      }
      if (receipt.purchaseOrderId) {
        await lockOrder(tx, receipt.purchaseOrderId, branchId);
      }
      const lines = await tx
        .select()
        .from(goodsReceiptItems)
        .where(eq(goodsReceiptItems.receiptId, id));
      const now = new Date();
      await this.inventory.applyMovements(
        tx,
        lines.map((l) => ({
          branchId,
          productId: l.productId,
          qtyDelta: dec(l.qty).negated().toFixed(3),
          reduceCostAt: l.unitCost,
          refType: 'goods_receipt' as const,
          refId: id,
          refCode: receipt.code,
          occurredAt: now,
          userId: user.id,
        })),
      );
      if (dec(receipt.total).gt(0)) {
        await tx.insert(debtLedger).values({
          branchId,
          partyType: 'supplier',
          partyId: receipt.supplierId,
          entryType: 'adjustment',
          refType: 'goods_receipt',
          refId: id,
          refCode: receipt.code,
          amount: dec(receipt.total).negated().toFixed(0),
          occurredAt: now,
          note: `Hủy phiếu nhập ${receipt.code}`,
          createdBy: user.id,
        });
      }
      await tx
        .update(goodsReceipts)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancelReason: reason?.trim() || null,
          updatedAt: now,
        })
        .where(eq(goodsReceipts.id, id));
      if (receipt.purchaseOrderId) {
        await syncOrderStatus(tx, receipt.purchaseOrderId);
      }
      await this.auditLog.record(tx, {
        action: 'goods_receipt.cancel',
        entityType: 'goods_receipt',
        entityId: id,
        before: { status: 'completed' },
        after: { status: 'cancelled', reason: reason?.trim() || null },
      });
    });
    return this.get(branchId, id);
  }

  /** Excel theo tiêu đề file "Chi tiết nhập hàng" của KiotViet (mỗi dòng hàng một dòng Excel). */
  async exportXlsx(
    branchId: string,
    q: ListGoodsReceiptsQueryDto,
  ): Promise<Buffer> {
    const { data, itemsById } = await this.list(branchId, q, 'export');
    const [branch] = await this.db
      .select({ name: branches.name })
      .from(branches)
      .where(eq(branches.id, branchId));
    const rows: CellValue[][] = [];
    for (const d of data) {
      for (const it of itemsById.get(d.id) ?? []) {
        rows.push([
          branch?.name ?? '',
          d.code,
          formatVnDateTime(d.receivedAt),
          d.purchaseOrder?.code ?? null,
          formatVnDateTime(d.createdAt),
          formatVnDateTime(d.updatedAt),
          d.supplier.code,
          d.supplier.name,
          d.receivedBy?.fullName ?? null,
          d.createdBy?.fullName ?? null,
          Number(d.total),
          Number(d.total),
          d.note,
          Number(d.totalQty),
          d.itemCount,
          RECEIPT_LABEL[d.status],
          it.code,
          it.name,
          Number(it.unitCost),
          Number(it.unitCost),
          Number(it.lineTotal),
          Number(it.qty),
        ]);
      }
    }
    return writeSheet(
      'Chi tiết nhập hàng',
      [
        'Chi nhánh',
        'Mã nhập hàng',
        'Thời gian',
        'Mã đặt hàng nhập',
        'Thời gian tạo',
        'Ngày cập nhật',
        'Mã nhà cung cấp',
        'Tên nhà cung cấp',
        'Người nhập',
        'Người tạo',
        'Tổng tiền hàng',
        'Cần trả NCC',
        'Ghi chú',
        'Tổng số lượng',
        'Tổng số mặt hàng',
        'Trạng thái',
        'Mã hàng',
        'Tên hàng',
        'Đơn giá',
        'Giá nhập',
        'Thành tiền',
        'Số lượng',
      ].map((header) => ({ header })),
      rows,
    );
  }

  // ---------------------------------------------------------------- nội bộ
  private headers(where: SQL | undefined) {
    return this.db
      .select({
        r: goodsReceipts,
        sCode: suppliers.code,
        sName: suppliers.name,
        poCode: purchaseOrders.code,
        rcvName: rcv.fullName,
        crtName: crt.fullName,
      })
      .from(goodsReceipts)
      .innerJoin(suppliers, eq(suppliers.id, goodsReceipts.supplierId))
      .leftJoin(
        purchaseOrders,
        eq(purchaseOrders.id, goodsReceipts.purchaseOrderId),
      )
      .leftJoin(rcv, eq(rcv.id, goodsReceipts.receivedBy))
      .leftJoin(crt, eq(crt.id, goodsReceipts.createdBy))
      .where(where);
  }

  /** Dòng hàng của các phiếu kèm số đã trả lại (phiếu trả hoàn tất). */
  private async itemsOf(ids: string[]) {
    const out = new Map<string, NonNullable<GoodsReceiptDto['items']>>();
    if (ids.length === 0) return out;
    const lines = await this.db
      .select({
        receiptId: goodsReceiptItems.receiptId,
        productId: goodsReceiptItems.productId,
        code: products.code,
        name: products.name,
        qty: goodsReceiptItems.qty,
        unitCost: goodsReceiptItems.unitCost,
        lineTotal: goodsReceiptItems.lineTotal,
      })
      .from(goodsReceiptItems)
      .innerJoin(products, eq(products.id, goodsReceiptItems.productId))
      .where(inArray(goodsReceiptItems.receiptId, ids))
      .orderBy(asc(products.code), asc(goodsReceiptItems.id));
    const returned = await this.db
      .select({
        receiptId: purchaseReturns.goodsReceiptId,
        productId: purchaseReturnItems.productId,
        qty: sql<string>`sum(${purchaseReturnItems.qty})`,
      })
      .from(purchaseReturnItems)
      .innerJoin(
        purchaseReturns,
        eq(purchaseReturns.id, purchaseReturnItems.returnId),
      )
      .where(
        and(
          inArray(purchaseReturns.goodsReceiptId, ids),
          eq(purchaseReturns.status, 'completed'),
        ),
      )
      .groupBy(purchaseReturns.goodsReceiptId, purchaseReturnItems.productId);
    const ret = new Map(
      returned.map((r) => [`${r.receiptId}|${r.productId}`, r.qty]),
    );
    for (const l of lines) {
      const list = out.get(l.receiptId) ?? [];
      list.push({
        productId: l.productId,
        code: l.code,
        name: l.name,
        qty: dec(l.qty).toFixed(3),
        unitCost: dec(l.unitCost).toFixed(4),
        lineTotal: dec(l.lineTotal).toFixed(0),
        returnedQty: dec(ret.get(`${l.receiptId}|${l.productId}`) ?? 0).toFixed(
          3,
        ),
      });
      out.set(l.receiptId, list);
    }
    return out;
  }

  private toDto(
    row: {
      r: typeof goodsReceipts.$inferSelect;
      sCode: string;
      sName: string;
      poCode: string | null;
      rcvName: string | null;
      crtName: string | null;
    },
    items: NonNullable<GoodsReceiptDto['items']>,
    withItems: boolean,
  ): GoodsReceiptDto {
    const r = row.r;
    const person = (id: string | null, name: string | null) =>
      id && name ? { id, fullName: name } : null;
    return {
      id: r.id,
      code: r.code,
      branchId: r.branchId,
      status: r.status,
      supplier: { id: r.supplierId, code: row.sCode, name: row.sName },
      purchaseOrder:
        r.purchaseOrderId && row.poCode
          ? { id: r.purchaseOrderId, code: row.poCode }
          : null,
      receivedAt: r.receivedAt.toISOString(),
      receivedBy: person(r.receivedBy, row.rcvName),
      total: dec(r.total).toFixed(0),
      ...summarizeLines(items),
      note: r.note,
      createdBy: person(r.createdBy, row.crtName),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
      cancelReason: r.cancelReason,
      ...(withItems ? { items } : {}),
    };
  }
}
