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
import { writeSheet, type CellValue } from '../../common/excel.js';
import { pageMeta, pageParams, parseSort } from '../../common/pagination.js';
import { formatVnDateTime } from '../../common/vn-date.js';
import { nextFreeDocumentCode } from '../../db/code-sequence.js';
import { DB, type Database, type DbOrTx } from '../../db/database.module.js';
import {
  branches,
  goodsReceipts,
  products,
  purchaseOrderItems,
  purchaseOrders,
  suppliers,
  users,
} from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';
import { DOC_EXPORT_MAX_ROWS } from './goods-receipts.service.js';
import { lockOrder, receivedByOrders } from './order-status.js';
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
  ORDER_SORT_FIELDS,
  type CreatePurchaseOrderDto,
  type ListPurchaseOrdersQueryDto,
  type OrderStatus,
  type PurchaseOrderDto,
  type UpdatePurchaseOrderDto,
} from './purchasing.dto.js';

const ORDER_LABEL: Record<OrderStatus, string> = {
  draft: 'Phiếu tạm',
  confirmed: 'Đã xác nhận NCC',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
};
const ordr = alias(users, 'orderer');
const crt = alias(users, 'creator');

/**
 * Đặt hàng nhập: đơn đặt với nhà cung cấp, KHÔNG chạm kho và công nợ. Một phiếu đặt được nhập nhiều lần
 * (nhập một phần); "đã nhập" luôn tính từ các phiếu nhập hoàn tất, không lưu.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly auditLog: AuditService,
  ) {}

  async list(
    branchId: string,
    q: ListPurchaseOrdersQueryDto,
    mode: 'page' | 'export' = 'page',
  ) {
    const { start, endExclusive } = dayRange(q.from, q.to);
    const where = and(
      eq(purchaseOrders.branchId, branchId),
      docSearch(purchaseOrders.code, suppliers.code, suppliers.name, q.q),
      q.supplierId ? eq(purchaseOrders.supplierId, q.supplierId) : undefined,
      q.status ? eq(purchaseOrders.status, q.status) : undefined,
      start ? gte(purchaseOrders.orderedAt, start) : undefined,
      endExclusive ? lt(purchaseOrders.orderedAt, endExclusive) : undefined,
    );
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(where);
    const sort = parseSort(q.sort, ORDER_SORT_FIELDS);
    const dir = sort?.desc === false ? asc : desc;
    const sortCol =
      sort?.field === 'code'
        ? purchaseOrders.code
        : sort?.field === 'total'
          ? purchaseOrders.total
          : purchaseOrders.orderedAt;
    const { page, limit, offset } =
      mode === 'export'
        ? { page: 1, limit: DOC_EXPORT_MAX_ROWS, offset: 0 }
        : pageParams(q);
    const rows = await this.headers(where)
      .orderBy(dir(sortCol), desc(purchaseOrders.id))
      .limit(limit)
      .offset(offset);
    const ids = rows.map((r) => r.r.id);
    const items = await this.itemsOf(ids);
    const received = await receivedByOrders(this.db, ids);
    return {
      data: rows.map((r) =>
        this.toDto(r, items.get(r.r.id) ?? [], received.get(r.r.id), false),
      ),
      meta: pageMeta(page, limit, total),
      itemsById: items,
    };
  }

  async get(branchId: string, id: string): Promise<PurchaseOrderDto> {
    const [row] = await this.headers(
      and(eq(purchaseOrders.id, id), eq(purchaseOrders.branchId, branchId)),
    );
    if (!row) throw notFound('phiếu đặt hàng nhập');
    const items = await this.itemsOf([id]);
    const received = await receivedByOrders(this.db, [id]);
    const dto = this.toDto(row, items.get(id) ?? [], received.get(id), true);
    const receipts = await this.db
      .select({ id: goodsReceipts.id, code: goodsReceipts.code })
      .from(goodsReceipts)
      .where(
        and(
          eq(goodsReceipts.purchaseOrderId, id),
          eq(goodsReceipts.status, 'completed'),
        ),
      )
      .orderBy(asc(goodsReceipts.receivedAt), asc(goodsReceipts.id));
    dto.receipts = receipts;
    return dto;
  }

  async create(
    user: AuthUser,
    branchId: string,
    input: CreatePurchaseOrderDto,
  ): Promise<PurchaseOrderDto> {
    const orderedAt = resolveTime(input.orderedAt, 'orderedAt');
    const id = await this.db.transaction(async (tx) => {
      await loadSupplier(tx, input.supplierId, true);
      const orderer = await resolvePerson(
        tx,
        input.orderedById,
        user.id,
        branchId,
        'orderedById',
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
      const code = await nextFreeDocumentCode(
        tx,
        DOCUMENT_PREFIX.purchaseOrder,
        async (c) => {
          const [hit] = await tx
            .select({ id: purchaseOrders.id })
            .from(purchaseOrders)
            .where(sql`lower(${purchaseOrders.code}) = lower(${c})`);
          return hit !== undefined;
        },
      );
      const [order] = await tx
        .insert(purchaseOrders)
        .values({
          code,
          branchId,
          supplierId: input.supplierId,
          status: input.status ?? 'draft',
          orderedAt,
          orderedBy: orderer,
          total,
          note: input.note?.trim() || null,
          createdBy: user.id,
        })
        .returning();
      await tx.insert(purchaseOrderItems).values(
        lines.map((l) => ({
          orderId: order!.id,
          productId: l.productId,
          qty: l.qty,
          unitCost: l.price,
          lineTotal: l.lineTotal,
        })),
      );
      await this.auditLog.record(tx, {
        action: 'purchase_order.create',
        entityType: 'purchase_order',
        entityId: order!.id,
        after: {
          code,
          supplierId: input.supplierId,
          total,
          status: order!.status,
          items: lines.length,
        },
      });
      return order!.id;
    });
    return this.get(branchId, id);
  }

  /** Sửa toàn bộ phiếu (thay hết dòng hàng). Chỉ khi chưa có phiếu nhập hoàn tất. */
  async update(
    user: AuthUser,
    branchId: string,
    id: string,
    input: UpdatePurchaseOrderDto,
  ): Promise<PurchaseOrderDto> {
    await this.db.transaction(async (tx) => {
      const order = await lockOrder(tx, id, branchId);
      await this.assertEditable(tx, order);
      if (input.status === 'draft' && order.status === 'confirmed') {
        throw new AppError(
          422,
          'INVALID_STATE',
          'Phiếu đã xác nhận không quay lại phiếu tạm được',
        );
      }
      await loadSupplier(tx, input.supplierId, true);
      const orderer = input.orderedById
        ? await resolvePerson(
            tx,
            input.orderedById,
            user.id,
            branchId,
            'orderedById',
          )
        : (order.orderedBy ?? user.id);
      const orderedAt = input.orderedAt
        ? resolveTime(input.orderedAt, 'orderedAt')
        : order.orderedAt;
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
      await tx
        .delete(purchaseOrderItems)
        .where(eq(purchaseOrderItems.orderId, id));
      await tx.insert(purchaseOrderItems).values(
        lines.map((l) => ({
          orderId: id,
          productId: l.productId,
          qty: l.qty,
          unitCost: l.price,
          lineTotal: l.lineTotal,
        })),
      );
      await tx
        .update(purchaseOrders)
        .set({
          supplierId: input.supplierId,
          status: input.status ?? order.status,
          orderedAt,
          orderedBy: orderer,
          total,
          note: input.note?.trim() || null,
          updatedAt: new Date(),
        })
        .where(eq(purchaseOrders.id, id));
      await this.auditLog.record(tx, {
        action: 'purchase_order.update',
        entityType: 'purchase_order',
        entityId: id,
        before: {
          supplierId: order.supplierId,
          total: order.total,
          status: order.status,
        },
        after: {
          supplierId: input.supplierId,
          total,
          status: input.status ?? order.status,
          items: lines.length,
        },
      });
    });
    return this.get(branchId, id);
  }

  async confirm(branchId: string, id: string): Promise<PurchaseOrderDto> {
    await this.db.transaction(async (tx) => {
      const order = await lockOrder(tx, id, branchId);
      if (order.status !== 'draft') {
        throw new AppError(422, 'INVALID_STATE', 'Chỉ xác nhận được phiếu tạm');
      }
      await this.setStatus(tx, id, 'confirmed', order.status);
    });
    return this.get(branchId, id);
  }

  /** "Kết thúc": đóng phiếu khi nhà cung cấp không giao nốt phần còn lại. Cần đã có ít nhất một phiếu nhập. */
  async complete(branchId: string, id: string): Promise<PurchaseOrderDto> {
    await this.db.transaction(async (tx) => {
      const order = await lockOrder(tx, id, branchId);
      if (order.status !== 'draft' && order.status !== 'confirmed') {
        throw new AppError(
          422,
          'INVALID_STATE',
          'Phiếu đã hoàn thành hoặc đã hủy',
        );
      }
      const received = await receivedByOrders(tx, [id]);
      if (!received.has(id)) {
        throw new AppError(
          422,
          'INVALID_STATE',
          'Chưa có phiếu nhập nào, hãy hủy phiếu nếu không đặt nữa',
        );
      }
      await this.setStatus(tx, id, 'completed', order.status);
    });
    return this.get(branchId, id);
  }

  async cancel(
    branchId: string,
    id: string,
    reason: string | undefined,
  ): Promise<PurchaseOrderDto> {
    await this.db.transaction(async (tx) => {
      const order = await lockOrder(tx, id, branchId);
      await this.assertEditable(tx, order);
      await tx
        .update(purchaseOrders)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: reason?.trim() || null,
          updatedAt: new Date(),
        })
        .where(eq(purchaseOrders.id, id));
      await this.auditLog.record(tx, {
        action: 'purchase_order.cancel',
        entityType: 'purchase_order',
        entityId: id,
        before: { status: order.status },
        after: { status: 'cancelled', reason: reason?.trim() || null },
      });
    });
    return this.get(branchId, id);
  }

  async exportXlsx(
    branchId: string,
    q: ListPurchaseOrdersQueryDto,
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
          formatVnDateTime(d.orderedAt),
          formatVnDateTime(d.updatedAt),
          d.supplier.code,
          d.supplier.name,
          d.orderedBy?.fullName ?? null,
          d.createdBy?.fullName ?? null,
          Number(d.total),
          Number(d.total),
          d.note,
          Number(d.totalQty),
          d.itemCount,
          ORDER_LABEL[d.status],
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
      'Chi tiết đặt hàng nhập',
      [
        'Chi nhánh',
        'Mã đặt hàng nhập',
        'Thời gian',
        'Ngày cập nhật',
        'Mã nhà cung cấp',
        'Tên nhà cung cấp',
        'Người đặt',
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
  private async setStatus(
    tx: DbOrTx,
    id: string,
    status: OrderStatus,
    from: OrderStatus,
  ) {
    await tx
      .update(purchaseOrders)
      .set({ status, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, id));
    await this.auditLog.record(tx, {
      action: `purchase_order.${status === 'confirmed' ? 'confirm' : 'complete'}`,
      entityType: 'purchase_order',
      entityId: id,
      before: { status: from },
      after: { status },
    });
  }

  /** Chỉ sửa/hủy được phiếu còn mở và chưa có phiếu nhập hoàn tất. */
  private async assertEditable(
    tx: DbOrTx,
    order: typeof purchaseOrders.$inferSelect,
  ) {
    if (order.status !== 'draft' && order.status !== 'confirmed') {
      throw new AppError(
        422,
        'INVALID_STATE',
        'Phiếu đã hoàn thành hoặc đã hủy, không thay đổi được',
      );
    }
    const received = await receivedByOrders(tx, [order.id]);
    if (received.size > 0) {
      throw new AppError(
        409,
        'INVALID_STATE',
        'Phiếu đã có phiếu nhập hàng, hãy hủy các phiếu nhập trước',
      );
    }
  }

  private headers(where: SQL | undefined) {
    return this.db
      .select({
        r: purchaseOrders,
        sCode: suppliers.code,
        sName: suppliers.name,
        ordName: ordr.fullName,
        crtName: crt.fullName,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .leftJoin(ordr, eq(ordr.id, purchaseOrders.orderedBy))
      .leftJoin(crt, eq(crt.id, purchaseOrders.createdBy))
      .where(where);
  }

  private async itemsOf(ids: string[]) {
    const out = new Map<
      string,
      Array<{
        productId: string;
        code: string;
        name: string;
        qty: string;
        unitCost: string;
        lineTotal: string;
      }>
    >();
    if (ids.length === 0) return out;
    const lines = await this.db
      .select({
        orderId: purchaseOrderItems.orderId,
        productId: purchaseOrderItems.productId,
        code: products.code,
        name: products.name,
        qty: purchaseOrderItems.qty,
        unitCost: purchaseOrderItems.unitCost,
        lineTotal: purchaseOrderItems.lineTotal,
      })
      .from(purchaseOrderItems)
      .innerJoin(products, eq(products.id, purchaseOrderItems.productId))
      .where(inArray(purchaseOrderItems.orderId, ids))
      .orderBy(asc(products.code), asc(purchaseOrderItems.id));
    for (const l of lines) {
      const list = out.get(l.orderId) ?? [];
      list.push({
        productId: l.productId,
        code: l.code,
        name: l.name,
        qty: dec(l.qty).toFixed(3),
        unitCost: dec(l.unitCost).toFixed(4),
        lineTotal: dec(l.lineTotal).toFixed(0),
      });
      out.set(l.orderId, list);
    }
    return out;
  }

  private toDto(
    row: {
      r: typeof purchaseOrders.$inferSelect;
      sCode: string;
      sName: string;
      ordName: string | null;
      crtName: string | null;
    },
    items: Array<{
      productId: string;
      code: string;
      name: string;
      qty: string;
      unitCost: string;
      lineTotal: string;
    }>,
    received: Map<string, string> | undefined,
    withItems: boolean,
  ): PurchaseOrderDto {
    const r = row.r;
    const person = (id: string | null, name: string | null) =>
      id && name ? { id, fullName: name } : null;
    const detailed = items.map((i) => {
      const got = dec(received?.get(i.productId) ?? 0);
      const left = dec(i.qty).minus(got);
      return {
        ...i,
        receivedQty: got.toFixed(3),
        remainingQty: (left.isNegative() ? dec(0) : left).toFixed(3),
      };
    });
    const anyReceived = detailed.some((i) => dec(i.receivedQty).gt(0));
    const allFull = detailed.every((i) => dec(i.remainingQty).isZero());
    return {
      id: r.id,
      code: r.code,
      branchId: r.branchId,
      status: r.status,
      receiveState: !anyReceived ? 'none' : allFull ? 'full' : 'partial',
      supplier: { id: r.supplierId, code: row.sCode, name: row.sName },
      orderedAt: r.orderedAt.toISOString(),
      orderedBy: person(r.orderedBy, row.ordName),
      total: dec(r.total).toFixed(0),
      ...summarizeLines(items),
      note: r.note,
      createdBy: person(r.createdBy, row.crtName),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
      cancelReason: r.cancelReason,
      ...(withItems ? { items: detailed } : {}),
    };
  }
}
