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
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { AppError } from '../../common/app-error.js';
import type { AuthUser } from '../../common/auth-user.js';
import { dec } from '../../common/costing.js';
import { writeSheet, type CellValue } from '../../common/excel.js';
import { pageMeta, pageParams, parseSort } from '../../common/pagination.js';
import { formatVnDateTime } from '../../common/vn-date.js';
import { nextFreeDocumentCode } from '../../db/code-sequence.js';
import { DB, type Database, type DbOrTx } from '../../db/database.module.js';
import {
  customers,
  invoices,
  orderItems,
  orders,
  products,
  users,
} from '../../db/schema/index.js';
import { searchWhere } from '../../db/search.js';
import { AuditService } from '../audit/audit.service.js';
import { PermissionsService } from '../authorization/permissions.service.js';
import { DOC_EXPORT_MAX_ROWS } from '../purchasing/goods-receipts.service.js';
import {
  dayRange,
  loadLineProducts,
  notFound,
  resolvePerson,
  resolveTime,
  summarizeLines,
} from '../purchasing/purchase-lines.js';
import {
  availableByProduct,
  canSeeDebt,
  creditWarning,
  loadCustomer,
  priceSaleLines,
  scopeOf,
  sellerFor,
  stockWarnings,
  type PricedSaleLine,
  type SaleWarning,
} from './sale-lines.js';
import {
  ORDER_SORT_FIELDS,
  type ListOrdersQueryDto,
  type OrderDto,
  type OrderItemDto,
  type SaleOrderStatus,
  type SaveOrderDto,
} from './sales.dto.js';

const STATUS_LABEL: Record<SaleOrderStatus, string> = {
  draft: 'Phiếu tạm',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
};
const seller = alias(users, 'seller');
const creator = alias(users, 'creator');
type OrderRow = typeof orders.$inferSelect;

/**
 * Đặt hàng (phiếu tạm). KHÔNG chạm kho, công nợ, quỹ: phiếu tạm chỉ "giữ hàng" qua số `reserved` tính khi đọc.
 * Xuất hóa đơn từ phiếu ở InvoicesService. Quyền "chỉ của mình" = phiếu có người bán là chính mình.
 */
@Injectable()
export class OrdersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly auditLog: AuditService,
    private readonly permissions: PermissionsService,
  ) {}

  async list(
    user: AuthUser,
    branchId: string,
    q: ListOrdersQueryDto,
    mode: 'page' | 'export' = 'page',
  ) {
    const own = (await scopeOf(this.permissions, user, 'order.view')) === 'own';
    const { start, endExclusive } = dayRange(q.from, q.to);
    const where = and(
      eq(orders.branchId, branchId),
      own ? eq(orders.sellerId, user.id) : undefined,
      saleSearch(orders.code, q.q),
      q.customerId ? eq(orders.customerId, q.customerId) : undefined,
      q.sellerId ? eq(orders.sellerId, q.sellerId) : undefined,
      q.status ? eq(orders.status, q.status) : undefined,
      start ? gte(orders.orderedAt, start) : undefined,
      endExclusive ? lt(orders.orderedAt, endExclusive) : undefined,
    );
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(where);
    const sort = parseSort(q.sort, ORDER_SORT_FIELDS);
    const dir = sort?.desc === false ? asc : desc;
    const sortCol =
      sort?.field === 'code'
        ? orders.code
        : sort?.field === 'total'
          ? orders.total
          : orders.orderedAt;
    const { page, limit, offset } =
      mode === 'export'
        ? { page: 1, limit: DOC_EXPORT_MAX_ROWS, offset: 0 }
        : pageParams(q);
    const rows = await this.headers(this.db, where)
      .orderBy(dir(sortCol), desc(orders.id))
      .limit(limit)
      .offset(offset);
    const ids = rows.map((r) => r.r.id);
    const items = await this.itemsOf(this.db, ids);
    const invoiceOf = await this.invoicesOf(this.db, ids);
    return {
      data: rows.map((r) =>
        this.toDto(r, items.get(r.r.id) ?? [], invoiceOf.get(r.r.id) ?? null, false),
      ),
      meta: pageMeta(page, limit, total),
      itemsById: items,
    };
  }

  async get(user: AuthUser, branchId: string, id: string): Promise<OrderDto> {
    const own = (await scopeOf(this.permissions, user, 'order.view')) === 'own';
    const [row] = await this.headers(
      this.db,
      and(
        eq(orders.id, id),
        eq(orders.branchId, branchId),
        own ? eq(orders.sellerId, user.id) : undefined,
      ),
    );
    if (!row) throw notFound('phiếu đặt hàng');
    const items = (await this.itemsOf(this.db, [id])).get(id) ?? [];
    const invoice = (await this.invoicesOf(this.db, [id])).get(id) ?? null;
    const dto = this.toDto(row, items, invoice, true);
    if (row.r.status === 'draft') {
      dto.warnings = await this.warningsFor(this.db, user, row.r, items);
      const avail = await availableByProduct(
        this.db,
        branchId,
        [...new Set(items.map((i) => i.productId))],
        id,
      );
      for (const it of dto.items ?? [])
        it.available = avail.get(it.productId)?.toFixed(3);
    }
    return dto;
  }

  async create(
    user: AuthUser,
    branchId: string,
    input: SaveOrderDto,
  ): Promise<OrderDto> {
    const scope = await scopeOf(this.permissions, user, 'order.create');
    const orderedAt = resolveTime(input.orderedAt, 'orderedAt');
    const id = await this.db.transaction(async (tx) => {
      const sellerId = await resolvePerson(
        tx,
        sellerFor(scope, user, input.sellerId, 'order.create'),
        user.id,
        branchId,
        'sellerId',
      );
      const { lines, subtotal, discount, total } = await this.prepare(tx, input);
      const code = await nextFreeDocumentCode(
        tx,
        DOCUMENT_PREFIX.order,
        async (c) => {
          const [hit] = await tx
            .select({ id: orders.id })
            .from(orders)
            .where(sql`lower(${orders.code}) = lower(${c})`);
          return hit !== undefined;
        },
      );
      const [order] = await tx
        .insert(orders)
        .values({
          code,
          branchId,
          customerId: input.customerId,
          status: 'draft',
          sellerId,
          orderedAt,
          subtotal,
          discount,
          total,
          ...ship(input),
          note: input.note?.trim() || null,
          createdBy: user.id,
        })
        .returning();
      await this.insertItems(tx, order!.id, lines);
      await this.auditLog.record(tx, {
        action: 'order.create',
        entityType: 'order',
        entityId: order!.id,
        after: { code, customerId: input.customerId, total, items: lines.length },
      });
      return order!.id;
    });
    return this.get(user, branchId, id);
  }

  /** Sửa toàn bộ phiếu tạm (thay hết dòng hàng). Chỉ khi còn là phiếu tạm. */
  async update(
    user: AuthUser,
    branchId: string,
    id: string,
    input: SaveOrderDto,
  ): Promise<OrderDto> {
    const scope = await scopeOf(this.permissions, user, 'order.create');
    await this.db.transaction(async (tx) => {
      const order = await this.lockDraft(tx, id, branchId, user, scope);
      const sellerId = await resolvePerson(
        tx,
        sellerFor(scope, user, input.sellerId ?? order.sellerId ?? undefined, 'order.create'),
        user.id,
        branchId,
        'sellerId',
      );
      const orderedAt = input.orderedAt
        ? resolveTime(input.orderedAt, 'orderedAt')
        : order.orderedAt;
      const { lines, subtotal, discount, total } = await this.prepare(tx, input);
      await tx.delete(orderItems).where(eq(orderItems.orderId, id));
      await this.insertItems(tx, id, lines);
      await tx
        .update(orders)
        .set({
          customerId: input.customerId,
          sellerId,
          orderedAt,
          subtotal,
          discount,
          total,
          ...ship(input),
          note: input.note?.trim() || null,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, id));
      await this.auditLog.record(tx, {
        action: 'order.update',
        entityType: 'order',
        entityId: id,
        before: { customerId: order.customerId, total: order.total },
        after: { customerId: input.customerId, total, items: lines.length },
      });
    });
    return this.get(user, branchId, id);
  }

  async cancel(
    user: AuthUser,
    branchId: string,
    id: string,
    reason: string | undefined,
  ): Promise<OrderDto> {
    const scope = await scopeOf(this.permissions, user, 'order.create');
    await this.db.transaction(async (tx) => {
      await this.lockDraft(tx, id, branchId, user, scope);
      await tx
        .update(orders)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: reason?.trim() || null,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, id));
      await this.auditLog.record(tx, {
        action: 'order.cancel',
        entityType: 'order',
        entityId: id,
        before: { status: 'draft' },
        after: { status: 'cancelled', reason: reason?.trim() || null },
      });
    });
    return this.get(user, branchId, id);
  }

  async exportXlsx(
    user: AuthUser,
    branchId: string,
    q: ListOrdersQueryDto,
  ): Promise<Buffer> {
    const { data, itemsById } = await this.list(user, branchId, q, 'export');
    const rows: CellValue[][] = [];
    for (const d of data) {
      for (const it of itemsById.get(d.id) ?? []) {
        rows.push([
          d.code,
          d.invoice?.code ?? null,
          d.ship.pickupAddress ?? null,
          formatVnDateTime(d.orderedAt),
          formatVnDateTime(d.createdAt),
          d.customer.code,
          d.customer.name,
          d.customer.phone,
          d.seller?.fullName ?? null,
          d.createdBy?.fullName ?? null,
          d.ship.name ?? null,
          d.ship.phone ?? null,
          d.ship.address ?? null,
          d.note,
          Number(d.subtotal),
          Number(d.discount),
          Number(d.total),
          STATUS_LABEL[d.status],
          it.code,
          it.name,
          it.note,
          Number(it.qty),
          Number(it.price),
          Number(it.discountPerUnit),
          Number(it.unitPrice),
          Number(it.lineTotal),
        ]);
      }
    }
    return writeSheet(
      'Chi tiết đặt hàng',
      [
        'Mã đặt hàng',
        'Mã hóa đơn',
        'Địa chỉ lấy hàng',
        'Thời gian',
        'Thời gian tạo',
        'Mã khách hàng',
        'Tên khách hàng',
        'Điện thoại',
        'Người nhận đặt',
        'Người tạo',
        'Người nhận',
        'Điện thoại (Người nhận)',
        'Địa chỉ (Người nhận)',
        'Ghi chú',
        'Tổng tiền hàng',
        'Giảm giá phiếu đặt',
        'Khách cần trả',
        'Trạng thái',
        'Mã hàng',
        'Tên hàng',
        'Ghi chú hàng hóa',
        'Số lượng',
        'Đơn giá',
        'Giảm giá',
        'Giá bán',
        'Thành tiền',
      ].map((header) => ({ header })),
      rows,
    );
  }

  // ---------------------------------------------------------------- nội bộ

  /** Kiểm tra khách và hàng, tính tiền (dùng chung cho tạo và sửa). */
  private async prepare(tx: DbOrTx, input: SaveOrderDto) {
    await loadCustomer(tx, input.customerId, true);
    const priced = priceSaleLines(input.items, input.discount);
    await loadLineProducts(
      tx,
      [...new Set(priced.lines.map((l) => l.productId))],
      true,
    );
    return priced;
  }

  private async insertItems(
    tx: DbOrTx,
    orderId: string,
    lines: ReturnType<typeof priceSaleLines>['lines'],
  ) {
    await tx.insert(orderItems).values(
      lines.map((l) => ({
        orderId,
        lineNo: l.lineNo,
        productId: l.productId,
        qty: l.qty,
        discountPerUnit: l.discountPerUnit,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        note: l.note,
      })),
    );
  }

  /** Khóa phiếu (FOR UPDATE); phải còn là phiếu tạm và (nếu quyền "chỉ của mình") do chính mình bán. */
  private async lockDraft(
    tx: DbOrTx,
    id: string,
    branchId: string,
    user: AuthUser,
    scope: Awaited<ReturnType<typeof scopeOf>>,
  ): Promise<OrderRow> {
    const order = await this.lockOrder(tx, id, branchId);
    if (scope === 'own' && order.sellerId !== user.id) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Bạn chỉ được sửa phiếu do chính mình bán',
        { permission: 'order.create' },
      );
    }
    if (order.status !== 'draft') {
      throw new AppError(
        422,
        'INVALID_STATE',
        'Chỉ sửa/hủy được phiếu tạm (phiếu đã xuất hóa đơn hoặc đã hủy)',
      );
    }
    return order;
  }

  /** Khóa phiếu (FOR UPDATE); không thấy hoặc thuộc chi nhánh khác → 404. */
  async lockOrder(tx: DbOrTx, id: string, branchId: string): Promise<OrderRow> {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.branchId, branchId)))
      .for('update');
    if (!order) throw notFound('phiếu đặt hàng');
    return order;
  }

  /** Các dòng hàng của phiếu (để xuất hóa đơn): đúng số lượng, đơn giá, giảm giá đã lưu. */
  async linesOf(tx: DbOrTx, orderId: string): Promise<PricedSaleLine[]> {
    const rows = await tx
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.lineNo), asc(orderItems.id));
    return rows.map((l) => ({
      lineNo: l.lineNo,
      productId: l.productId,
      qty: dec(l.qty).toFixed(3),
      price: dec(l.unitPrice).plus(dec(l.discountPerUnit)).toFixed(0),
      discountPerUnit: dec(l.discountPerUnit).toFixed(0),
      unitPrice: dec(l.unitPrice).toFixed(0),
      lineTotal: dec(l.lineTotal).toFixed(0),
      note: l.note,
    }));
  }

  private async warningsFor(
    db: DbOrTx,
    user: AuthUser,
    order: OrderRow,
    items: OrderItemDto[],
  ): Promise<SaleWarning[]> {
    const codes = new Map(items.map((i) => [i.productId, { code: i.code }]));
    const out = await stockWarnings(db, order.branchId, items, codes, order.id);
    const credit = await creditWarning(
      db,
      order.customerId,
      order.branchId,
      order.total,
      await canSeeDebt(db, this.permissions, user, order.customerId),
    );
    if (credit) out.push(credit);
    return out;
  }

  private headers(db: DbOrTx, where: SQL | undefined) {
    return db
      .select({
        r: orders,
        cCode: customers.code,
        cName: customers.name,
        cPhone: customers.phone,
        sellerName: seller.fullName,
        creatorName: creator.fullName,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .leftJoin(seller, eq(seller.id, orders.sellerId))
      .leftJoin(creator, eq(creator.id, orders.createdBy))
      .where(where);
  }

  private async itemsOf(db: DbOrTx, ids: string[]) {
    const out = new Map<string, OrderItemDto[]>();
    if (ids.length === 0) return out;
    const lines = await db
      .select({
        orderId: orderItems.orderId,
        lineNo: orderItems.lineNo,
        productId: orderItems.productId,
        code: products.code,
        name: products.name,
        qty: orderItems.qty,
        discountPerUnit: orderItems.discountPerUnit,
        unitPrice: orderItems.unitPrice,
        lineTotal: orderItems.lineTotal,
        note: orderItems.note,
      })
      .from(orderItems)
      .innerJoin(products, eq(products.id, orderItems.productId))
      .where(inArray(orderItems.orderId, ids))
      .orderBy(asc(orderItems.lineNo), asc(orderItems.id));
    for (const l of lines) {
      const list = out.get(l.orderId) ?? [];
      list.push({
        lineNo: l.lineNo,
        productId: l.productId,
        code: l.code,
        name: l.name,
        qty: dec(l.qty).toFixed(3),
        price: dec(l.unitPrice).plus(dec(l.discountPerUnit)).toFixed(0),
        discountPerUnit: dec(l.discountPerUnit).toFixed(0),
        unitPrice: dec(l.unitPrice).toFixed(0),
        lineTotal: dec(l.lineTotal).toFixed(0),
        note: l.note,
      });
      out.set(l.orderId, list);
    }
    return out;
  }

  /** Hóa đơn HOÀN TẤT xuất từ từng phiếu (hóa đơn đã hủy thì phiếu đã về phiếu tạm). */
  private async invoicesOf(db: DbOrTx, ids: string[]) {
    const out = new Map<string, { id: string; code: string }>();
    if (ids.length === 0) return out;
    for (const r of await db
      .select({ orderId: invoices.orderId, id: invoices.id, code: invoices.code })
      .from(invoices)
      .where(and(inArray(invoices.orderId, ids), eq(invoices.status, 'completed')))) {
      if (r.orderId) out.set(r.orderId, { id: r.id, code: r.code });
    }
    return out;
  }

  private toDto(
    row: {
      r: OrderRow;
      cCode: string;
      cName: string;
      cPhone: string | null;
      sellerName: string | null;
      creatorName: string | null;
    },
    items: OrderItemDto[],
    invoice: { id: string; code: string } | null,
    withItems: boolean,
  ): OrderDto {
    const r = row.r;
    const person = (id: string | null, name: string | null) =>
      id && name ? { id, fullName: name } : null;
    return {
      id: r.id,
      code: r.code,
      status: r.status,
      branchId: r.branchId,
      customer: { id: r.customerId, code: row.cCode, name: row.cName, phone: row.cPhone },
      seller: person(r.sellerId, row.sellerName),
      orderedAt: r.orderedAt.toISOString(),
      subtotal: dec(r.subtotal).toFixed(0),
      discount: dec(r.discount).toFixed(0),
      total: dec(r.total).toFixed(0),
      ...summarizeLines(items),
      ship: {
        pickupAddress: r.pickupAddress,
        name: r.shipName,
        phone: r.shipPhone,
        address: r.shipAddress,
      },
      note: r.note,
      invoice,
      createdBy: person(r.createdBy, row.creatorName),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
      cancelReason: r.cancelReason,
      ...(withItems ? { items } : {}),
    };
  }
}

/** Tìm không dấu theo mã phiếu, mã/tên/SĐT khách (cần join `customers`). */
export function saleSearch(docCode: AnyPgColumn, q: string | undefined) {
  return searchWhere(
    sql`f_search_text(${docCode} || ' ' || ${customers.code} || ' ' || ${customers.name} || ' ' || coalesce(${customers.phone}, ''))`,
    q,
  );
}

function ship(input: SaveOrderDto) {
  const t = (v: string | null | undefined) => v?.trim() || null;
  return {
    pickupAddress: t(input.ship?.pickupAddress),
    shipName: t(input.ship?.name),
    shipPhone: t(input.ship?.phone),
    shipAddress: t(input.ship?.address),
  };
}
