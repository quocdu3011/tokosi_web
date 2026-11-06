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
  purchaseReturnItems,
  purchaseReturns,
  suppliers,
  users,
} from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
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
import { DOC_EXPORT_MAX_ROWS } from './goods-receipts.service.js';
import {
  RETURN_SORT_FIELDS,
  type CreatePurchaseReturnDto,
  type ListPurchaseReturnsQueryDto,
  type PurchaseReturnDto,
} from './purchasing.dto.js';

const RETURN_LABEL = { completed: 'Đã trả hàng', cancelled: 'Đã hủy' } as const;
const ret = alias(users, 'returner');
const crt = alias(users, 'creator');

/**
 * Trả hàng nhập: trừ tồn (giá vốn bình quân tính lại theo giá trả) và GIẢM công nợ nhà cung cấp. Tiền hoàn lại
 * (nếu có) ghi bằng phiếu thu ở Sổ quỹ, không nằm ở phiếu này (nên không có cột hình thức thanh toán).
 */
@Injectable()
export class PurchaseReturnsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly auditLog: AuditService,
    private readonly inventory: InventoryService,
  ) {}

  async list(
    branchId: string,
    q: ListPurchaseReturnsQueryDto,
    mode: 'page' | 'export' = 'page',
  ) {
    const { start, endExclusive } = dayRange(q.from, q.to);
    const where = and(
      eq(purchaseReturns.branchId, branchId),
      docSearch(purchaseReturns.code, suppliers.code, suppliers.name, q.q),
      q.supplierId ? eq(purchaseReturns.supplierId, q.supplierId) : undefined,
      q.goodsReceiptId
        ? eq(purchaseReturns.goodsReceiptId, q.goodsReceiptId)
        : undefined,
      q.status ? eq(purchaseReturns.status, q.status) : undefined,
      start ? gte(purchaseReturns.returnedAt, start) : undefined,
      endExclusive ? lt(purchaseReturns.returnedAt, endExclusive) : undefined,
    );
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(purchaseReturns)
      .innerJoin(suppliers, eq(suppliers.id, purchaseReturns.supplierId))
      .where(where);
    const sort = parseSort(q.sort, RETURN_SORT_FIELDS);
    const dir = sort?.desc === false ? asc : desc;
    const sortCol =
      sort?.field === 'code'
        ? purchaseReturns.code
        : sort?.field === 'total'
          ? purchaseReturns.total
          : purchaseReturns.returnedAt;
    const { page, limit, offset } =
      mode === 'export'
        ? { page: 1, limit: DOC_EXPORT_MAX_ROWS, offset: 0 }
        : pageParams(q);
    const rows = await this.headers(where)
      .orderBy(dir(sortCol), desc(purchaseReturns.id))
      .limit(limit)
      .offset(offset);
    const items = await this.itemsOf(rows.map((r) => r.r.id));
    return {
      data: rows.map((r) => this.toDto(r, items.get(r.r.id) ?? [], false)),
      meta: pageMeta(page, limit, total),
      itemsById: items,
    };
  }

  async get(branchId: string, id: string): Promise<PurchaseReturnDto> {
    const [row] = await this.headers(
      and(eq(purchaseReturns.id, id), eq(purchaseReturns.branchId, branchId)),
    );
    if (!row) throw notFound('phiếu trả hàng nhập');
    const items = await this.itemsOf([id]);
    return this.toDto(row, items.get(id) ?? [], true);
  }

  async create(
    user: AuthUser,
    branchId: string,
    input: CreatePurchaseReturnDto,
  ): Promise<PurchaseReturnDto> {
    const returnedAt = resolveTime(input.returnedAt, 'returnedAt');
    const id = await this.db.transaction(async (tx) => {
      await lockPartyBranch(tx, 'supplier', input.supplierId, branchId);
      await loadSupplier(tx, input.supplierId, true);
      const returner = await resolvePerson(
        tx,
        input.returnedById,
        user.id,
        branchId,
        'returnedById',
      );
      const { lines, total } = priceLines(
        input.items.map((i) => ({
          productId: i.productId,
          qty: i.qty,
          price: i.returnPrice,
        })),
      );
      await loadLineProducts(
        tx,
        lines.map((l) => l.productId),
        false,
      );

      if (input.goodsReceiptId) {
        // Khóa phiếu nhập gốc: hai phiếu trả song song không cùng vượt số đã nhập.
        const [receipt] = await tx
          .select()
          .from(goodsReceipts)
          .where(eq(goodsReceipts.id, input.goodsReceiptId))
          .for('update');
        if (!receipt || receipt.branchId !== branchId) {
          throw notFound('phiếu nhập hàng');
        }
        if (receipt.status !== 'completed') {
          throw new AppError(422, 'INVALID_STATE', 'Phiếu nhập đã hủy');
        }
        if (receipt.supplierId !== input.supplierId) {
          throw new AppError(
            400,
            'VALIDATION_ERROR',
            'Phiếu nhập thuộc nhà cung cấp khác',
            [
              {
                field: 'goodsReceiptId',
                message: 'Khác nhà cung cấp của phiếu trả',
              },
            ],
          );
        }
        await this.assertWithinReceipt(tx, input.goodsReceiptId, lines);
      }

      const code = await nextFreeDocumentCode(
        tx,
        DOCUMENT_PREFIX.purchaseReturn,
        async (c) => {
          const [hit] = await tx
            .select({ id: purchaseReturns.id })
            .from(purchaseReturns)
            .where(sql`lower(${purchaseReturns.code}) = lower(${c})`);
          return hit !== undefined;
        },
      );
      const [row] = await tx
        .insert(purchaseReturns)
        .values({
          code,
          branchId,
          supplierId: input.supplierId,
          goodsReceiptId: input.goodsReceiptId ?? null,
          returnedAt,
          returnedBy: returner,
          total,
          note: input.note?.trim() || null,
          createdBy: user.id,
        })
        .returning();
      await tx.insert(purchaseReturnItems).values(
        lines.map((l) => ({
          returnId: row!.id,
          productId: l.productId,
          qty: l.qty,
          returnPrice: l.price,
          lineTotal: l.lineTotal,
        })),
      );
      await this.inventory.applyMovements(
        tx,
        lines.map((l) => ({
          branchId,
          productId: l.productId,
          qtyDelta: dec(l.qty).negated().toFixed(3),
          reduceCostAt: l.price,
          refType: 'purchase_return' as const,
          refId: row!.id,
          refCode: code,
          occurredAt: returnedAt,
          userId: user.id,
        })),
      );
      if (dec(total).gt(0)) {
        await tx.insert(debtLedger).values({
          branchId,
          partyType: 'supplier',
          partyId: input.supplierId,
          entryType: 'return',
          refType: 'purchase_return',
          refId: row!.id,
          refCode: code,
          amount: dec(total).negated().toFixed(0),
          occurredAt: returnedAt,
          createdBy: user.id,
        });
      }
      await this.auditLog.record(tx, {
        action: 'purchase_return.create',
        entityType: 'purchase_return',
        entityId: row!.id,
        after: {
          code,
          supplierId: input.supplierId,
          total,
          items: lines.length,
        },
      });
      return row!.id;
    });
    return this.get(branchId, id);
  }

  async updateNote(
    branchId: string,
    id: string,
    note: string | null,
  ): Promise<PurchaseReturnDto> {
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(purchaseReturns)
        .where(
          and(
            eq(purchaseReturns.id, id),
            eq(purchaseReturns.branchId, branchId),
          ),
        );
      if (!before) throw notFound('phiếu trả hàng nhập');
      const next = note?.trim() || null;
      await tx
        .update(purchaseReturns)
        .set({ note: next, updatedAt: new Date() })
        .where(eq(purchaseReturns.id, id));
      await this.auditLog.record(tx, {
        action: 'purchase_return.update_note',
        entityType: 'purchase_return',
        entityId: id,
        before: { note: before.note },
        after: { note: next },
      });
    });
    return this.get(branchId, id);
  }

  /** Hủy phiếu trả: nhập lại hàng (theo giá trả) và tăng lại công nợ. */
  async cancel(
    user: AuthUser,
    branchId: string,
    id: string,
    reason: string | undefined,
  ): Promise<PurchaseReturnDto> {
    const [pre] = await this.db
      .select({ supplierId: purchaseReturns.supplierId })
      .from(purchaseReturns)
      .where(
        and(eq(purchaseReturns.id, id), eq(purchaseReturns.branchId, branchId)),
      );
    if (!pre) throw notFound('phiếu trả hàng nhập');

    await this.db.transaction(async (tx) => {
      await lockPartyBranch(tx, 'supplier', pre.supplierId, branchId);
      const [row] = await tx
        .select()
        .from(purchaseReturns)
        .where(eq(purchaseReturns.id, id))
        .for('update');
      if (!row) throw notFound('phiếu trả hàng nhập');
      if (row.status !== 'completed') {
        throw new AppError(422, 'INVALID_STATE', 'Phiếu trả hàng nhập đã hủy');
      }
      const lines = await tx
        .select()
        .from(purchaseReturnItems)
        .where(eq(purchaseReturnItems.returnId, id));
      const now = new Date();
      await this.inventory.applyMovements(
        tx,
        lines.map((l) => ({
          branchId,
          productId: l.productId,
          qtyDelta: dec(l.qty).toFixed(3),
          unitCost: l.returnPrice,
          refType: 'purchase_return' as const,
          refId: id,
          refCode: row.code,
          occurredAt: now,
          userId: user.id,
        })),
      );
      if (dec(row.total).gt(0)) {
        await tx.insert(debtLedger).values({
          branchId,
          partyType: 'supplier',
          partyId: row.supplierId,
          entryType: 'adjustment',
          refType: 'purchase_return',
          refId: id,
          refCode: row.code,
          amount: dec(row.total).toFixed(0),
          occurredAt: now,
          note: `Hủy phiếu trả hàng nhập ${row.code}`,
          createdBy: user.id,
        });
      }
      await tx
        .update(purchaseReturns)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancelReason: reason?.trim() || null,
          updatedAt: now,
        })
        .where(eq(purchaseReturns.id, id));
      await this.auditLog.record(tx, {
        action: 'purchase_return.cancel',
        entityType: 'purchase_return',
        entityId: id,
        before: { status: 'completed' },
        after: { status: 'cancelled', reason: reason?.trim() || null },
      });
    });
    return this.get(branchId, id);
  }

  async exportXlsx(
    branchId: string,
    q: ListPurchaseReturnsQueryDto,
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
          formatVnDateTime(d.returnedAt),
          formatVnDateTime(d.createdAt),
          d.supplier.code,
          d.supplier.name,
          d.returnedBy?.fullName ?? null,
          Number(d.total),
          Number(d.total),
          d.createdBy?.fullName ?? null,
          d.note,
          Number(d.totalQty),
          d.itemCount,
          RETURN_LABEL[d.status],
          it.code,
          it.name,
          Number(it.returnPrice),
          Number(it.qty),
          Number(it.lineTotal),
        ]);
      }
    }
    return writeSheet(
      'Chi tiết trả hàng nhập',
      [
        'Chi nhánh',
        'Mã trả hàng nhập',
        'Thời gian',
        'Thời gian tạo',
        'Mã nhà cung cấp',
        'Tên nhà cung cấp',
        'Người trả',
        'Tổng tiền hàng trả',
        'NCC cần trả',
        'Người tạo',
        'Ghi chú',
        'Tổng số lượng',
        'Tổng số mặt hàng',
        'Trạng thái',
        'Mã hàng',
        'Tên hàng',
        'Giá trả lại',
        'Số lượng',
        'Thành tiền',
      ].map((header) => ({ header })),
      rows,
    );
  }

  // ---------------------------------------------------------------- nội bộ
  /** Mỗi dòng phải có trong phiếu nhập gốc và (đã trả + lần này) ≤ số đã nhập. Phiếu nhập đã được khóa. */
  private async assertWithinReceipt(
    tx: Pick<Database, 'select'>,
    receiptId: string,
    lines: Array<{ productId: string; qty: string }>,
  ): Promise<void> {
    const received = new Map(
      (
        await tx
          .select({
            productId: goodsReceiptItems.productId,
            qty: goodsReceiptItems.qty,
          })
          .from(goodsReceiptItems)
          .where(eq(goodsReceiptItems.receiptId, receiptId))
      ).map((r) => [r.productId, r.qty]),
    );
    const returned = new Map(
      (
        await tx
          .select({
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
              eq(purchaseReturns.goodsReceiptId, receiptId),
              eq(purchaseReturns.status, 'completed'),
            ),
          )
          .groupBy(purchaseReturnItems.productId)
      ).map((r) => [r.productId, r.qty]),
    );
    const problems: Array<{ field: string; message: string }> = [];
    lines.forEach((l, i) => {
      const got = received.get(l.productId);
      if (got === undefined) {
        problems.push({
          field: `items.${i}.productId`,
          message: 'Hàng này không có trong phiếu nhập gốc',
        });
        return;
      }
      const left = dec(got).minus(dec(returned.get(l.productId) ?? 0));
      if (dec(l.qty).gt(left)) {
        problems.push({
          field: `items.${i}.qty`,
          message: `Chỉ còn trả được tối đa ${left.toFixed(3)}`,
        });
      }
    });
    if (problems.length > 0) {
      throw new AppError(
        422,
        'RETURN_QTY_EXCEEDED',
        'Số lượng trả vượt số đã nhập',
        problems,
      );
    }
  }

  private headers(where: SQL | undefined) {
    return this.db
      .select({
        r: purchaseReturns,
        sCode: suppliers.code,
        sName: suppliers.name,
        grCode: goodsReceipts.code,
        retName: ret.fullName,
        crtName: crt.fullName,
      })
      .from(purchaseReturns)
      .innerJoin(suppliers, eq(suppliers.id, purchaseReturns.supplierId))
      .leftJoin(
        goodsReceipts,
        eq(goodsReceipts.id, purchaseReturns.goodsReceiptId),
      )
      .leftJoin(ret, eq(ret.id, purchaseReturns.returnedBy))
      .leftJoin(crt, eq(crt.id, purchaseReturns.createdBy))
      .where(where);
  }

  private async itemsOf(ids: string[]) {
    const out = new Map<string, NonNullable<PurchaseReturnDto['items']>>();
    if (ids.length === 0) return out;
    const lines = await this.db
      .select({
        returnId: purchaseReturnItems.returnId,
        productId: purchaseReturnItems.productId,
        code: products.code,
        name: products.name,
        qty: purchaseReturnItems.qty,
        returnPrice: purchaseReturnItems.returnPrice,
        lineTotal: purchaseReturnItems.lineTotal,
      })
      .from(purchaseReturnItems)
      .innerJoin(products, eq(products.id, purchaseReturnItems.productId))
      .where(inArray(purchaseReturnItems.returnId, ids))
      .orderBy(asc(products.code), asc(purchaseReturnItems.id));
    for (const l of lines) {
      const list = out.get(l.returnId) ?? [];
      list.push({
        productId: l.productId,
        code: l.code,
        name: l.name,
        qty: dec(l.qty).toFixed(3),
        returnPrice: dec(l.returnPrice).toFixed(4),
        lineTotal: dec(l.lineTotal).toFixed(0),
      });
      out.set(l.returnId, list);
    }
    return out;
  }

  private toDto(
    row: {
      r: typeof purchaseReturns.$inferSelect;
      sCode: string;
      sName: string;
      grCode: string | null;
      retName: string | null;
      crtName: string | null;
    },
    items: NonNullable<PurchaseReturnDto['items']>,
    withItems: boolean,
  ): PurchaseReturnDto {
    const r = row.r;
    const person = (id: string | null, name: string | null) =>
      id && name ? { id, fullName: name } : null;
    return {
      id: r.id,
      code: r.code,
      branchId: r.branchId,
      status: r.status,
      supplier: { id: r.supplierId, code: row.sCode, name: row.sName },
      goodsReceipt:
        r.goodsReceiptId && row.grCode
          ? { id: r.goodsReceiptId, code: row.grCode }
          : null,
      returnedAt: r.returnedAt.toISOString(),
      returnedBy: person(r.returnedBy, row.retName),
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
