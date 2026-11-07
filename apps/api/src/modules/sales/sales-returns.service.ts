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
import { lockPartyBranch } from '../../common/advisory-lock.js';
import { allocateProportionally, dec, lineTotal } from '../../common/costing.js';
import { writeSheet, type CellValue } from '../../common/excel.js';
import { pageMeta, pageParams, parseSort } from '../../common/pagination.js';
import { formatVnDateTime } from '../../common/vn-date.js';
import { nextFreeDocumentCode } from '../../db/code-sequence.js';
import { DB, type Database, type DbOrTx } from '../../db/database.module.js';
import {
  branches,
  customers,
  debtLedger,
  invoiceItems,
  invoices,
  products,
  salesReturnItems,
  salesReturns,
  users,
} from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';
import { PermissionsService } from '../authorization/permissions.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { DOC_EXPORT_MAX_ROWS } from '../purchasing/goods-receipts.service.js';
import {
  dayRange,
  loadLineProducts,
  notFound,
  resolvePerson,
  resolveTime,
  summarizeLines,
} from '../purchasing/purchase-lines.js';
import { saleSearch } from './orders.service.js';
import { loadCustomer, scopeOf } from './sale-lines.js';
import {
  RETURN_SORT_FIELDS,
  type CreateSalesReturnDto,
  type ListSalesReturnsQueryDto,
  type SalesReturnDto,
  type SalesReturnItemDto,
  type SalesReturnStatus,
} from './sales.dto.js';

const STATUS_LABEL: Record<SalesReturnStatus, string> = {
  completed: 'Đã trả',
  cancelled: 'Đã hủy',
};
const receiver = alias(users, 'receiver');
const creator = alias(users, 'creator');
const invSeller = alias(users, 'inv_seller');
type ReturnRow = typeof salesReturns.$inferSelect;

/**
 * Trả hàng bán: khách trả hàng, tiền trả khách LUÔN ghi giảm công nợ khách tại chi nhánh (không hoàn tiền trên phiếu).
 * Dòng `restock` cộng lại tồn nhưng KHÔNG đổi giá vốn bình quân; chênh lệch giá nhập lại tính vào lợi nhuận. Có hóa đơn
 * gốc thì tổng trả không vượt số đã bán. Thứ tự khóa: nợ khách+chi nhánh → hóa đơn gốc (FOR UPDATE) → dòng tồn.
 */
@Injectable()
export class SalesReturnsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly auditLog: AuditService,
    private readonly permissions: PermissionsService,
    private readonly inventory: InventoryService,
  ) {}

  async list(
    user: AuthUser,
    branchId: string,
    q: ListSalesReturnsQueryDto,
    mode: 'page' | 'export' = 'page',
  ) {
    // "Chỉ của mình": chỉ phiếu trả của hóa đơn do mình bán (phiếu không tham chiếu hóa đơn thì không thuộc ai)
    const own = (await scopeOf(this.permissions, user, 'invoice.view')) === 'own';
    const { start, endExclusive } = dayRange(q.from, q.to);
    const where = and(
      eq(salesReturns.branchId, branchId),
      own ? eq(invoices.sellerId, user.id) : undefined,
      saleSearch(salesReturns.code, q.q),
      q.customerId ? eq(salesReturns.customerId, q.customerId) : undefined,
      q.sellerId ? eq(invoices.sellerId, q.sellerId) : undefined,
      q.invoiceId ? eq(salesReturns.invoiceId, q.invoiceId) : undefined,
      q.status ? eq(salesReturns.status, q.status) : undefined,
      start ? gte(salesReturns.returnedAt, start) : undefined,
      endExclusive ? lt(salesReturns.returnedAt, endExclusive) : undefined,
    );
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(salesReturns)
      .innerJoin(customers, eq(customers.id, salesReturns.customerId))
      .leftJoin(invoices, eq(invoices.id, salesReturns.invoiceId))
      .where(where);
    const sort = parseSort(q.sort, RETURN_SORT_FIELDS);
    const dir = sort?.desc === false ? asc : desc;
    const sortCol =
      sort?.field === 'code'
        ? salesReturns.code
        : sort?.field === 'total'
          ? salesReturns.total
          : salesReturns.returnedAt;
    const { page, limit, offset } =
      mode === 'export'
        ? { page: 1, limit: DOC_EXPORT_MAX_ROWS, offset: 0 }
        : pageParams(q);
    const rows = await this.headers(this.db, where)
      .orderBy(dir(sortCol), desc(salesReturns.id))
      .limit(limit)
      .offset(offset);
    const ids = rows.map((r) => r.r.id);
    const items = await this.itemsOf(this.db, ids);
    return {
      data: rows.map((r) => this.toDto(r, items.get(r.r.id) ?? [], false)),
      meta: pageMeta(page, limit, total),
      itemsById: items,
    };
  }

  async get(
    user: AuthUser,
    branchId: string,
    id: string,
  ): Promise<SalesReturnDto> {
    const own = (await scopeOf(this.permissions, user, 'invoice.view')) === 'own';
    const [row] = await this.headers(
      this.db,
      and(
        eq(salesReturns.id, id),
        eq(salesReturns.branchId, branchId),
        own ? eq(invoices.sellerId, user.id) : undefined,
      ),
    );
    if (!row) throw notFound('phiếu trả hàng');
    const items = (await this.itemsOf(this.db, [id])).get(id) ?? [];
    const dto = this.toDto(row, items, true);
    if (await this.permissions.has(user.role, 'product.cost.view')) {
      dto.priceDifference = items
        .filter((i) => i.restock)
        .reduce(
          (s, i) =>
            s.plus(
              dec(i.returnPrice)
                .minus(dec(i.restockPrice ?? i.returnPrice))
                .times(dec(i.qty)),
            ),
          dec(0),
        )
        .toFixed(0);
    }
    return dto;
  }

  async create(
    user: AuthUser,
    branchId: string,
    input: CreateSalesReturnDto,
  ): Promise<SalesReturnDto> {
    const scope = await scopeOf(this.permissions, user, 'return.create');
    if (scope === 'own' && !input.invoiceId) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Bạn chỉ được trả hàng cho hóa đơn do chính mình bán',
        { permission: 'return.create' },
      );
    }
    const returnedAt = resolveTime(input.returnedAt, 'returnedAt');
    const id = await this.db.transaction(async (tx) => {
      // Khóa nợ khách+chi nhánh ĐẦU TIÊN (phiếu này ghi giảm công nợ)
      await lockPartyBranch(tx, 'customer', input.customerId, branchId);
      await loadCustomer(tx, input.customerId, false);
      const receivedBy = await resolvePerson(
        tx,
        input.receivedById,
        user.id,
        branchId,
        'receivedById',
      );
      const lines = input.items.map((l, i) => {
        if (dec(l.qty).lte(0)) {
          throw new AppError(400, 'VALIDATION_ERROR', 'Số lượng phải lớn hơn 0', [
            { field: `items.${i}.qty`, message: 'Số lượng phải lớn hơn 0' },
          ]);
        }
        const restock = l.restock ?? true;
        return {
          productId: l.productId,
          qty: l.qty,
          returnPrice: dec(l.returnPrice).toFixed(0),
          restock,
          restockPrice: restock
            ? dec(l.restockPrice ?? l.returnPrice).toFixed(0)
            : null,
          lineTotal: lineTotal(l.qty, l.returnPrice),
          note: l.note?.trim() || null,
        };
      });
      const total = lines
        .reduce((s, l) => s.plus(dec(l.lineTotal)), dec(0))
        .toFixed(0);
      // Trả hàng vẫn cho phép với hàng đã ngưng kinh doanh
      await loadLineProducts(
        tx,
        [...new Set(lines.map((l) => l.productId))],
        false,
      );
      if (input.invoiceId) {
        await this.checkInvoice(tx, user, scope, branchId, input, lines);
      }
      const code = await nextFreeDocumentCode(
        tx,
        DOCUMENT_PREFIX.salesReturn,
        async (c) => {
          const [hit] = await tx
            .select({ id: salesReturns.id })
            .from(salesReturns)
            .where(sql`lower(${salesReturns.code}) = lower(${c})`);
          return hit !== undefined;
        },
      );
      const [ret] = await tx
        .insert(salesReturns)
        .values({
          code,
          branchId,
          customerId: input.customerId,
          invoiceId: input.invoiceId ?? null,
          status: 'completed',
          returnedAt,
          total,
          receivedBy,
          note: input.note?.trim() || null,
          createdBy: user.id,
        })
        .returning();
      await tx.insert(salesReturnItems).values(
        lines.map((l) => ({
          returnId: ret!.id,
          productId: l.productId,
          qty: l.qty,
          returnPrice: l.returnPrice,
          lineTotal: l.lineTotal,
          restock: l.restock,
          restockPrice: l.restockPrice,
          note: l.note,
        })),
      );
      // Nhập lại kho: KHÔNG truyền unitCost → cộng theo giá vốn hiện tại, giá vốn bình quân giữ nguyên
      const restocked = lines.filter((l) => l.restock);
      if (restocked.length > 0) {
        await this.inventory.applyMovements(
          tx,
          restocked.map((l) => ({
            branchId,
            productId: l.productId,
            qtyDelta: dec(l.qty).toFixed(3),
            refType: 'sales_return' as const,
            refId: ret!.id,
            refCode: code,
            occurredAt: returnedAt,
            userId: user.id,
          })),
        );
      }
      if (dec(total).gt(0)) {
        await tx.insert(debtLedger).values({
          branchId,
          partyType: 'customer',
          partyId: input.customerId,
          entryType: 'return',
          refType: 'sales_return',
          refId: ret!.id,
          refCode: code,
          amount: dec(total).negated().toFixed(0),
          occurredAt: returnedAt,
          createdBy: user.id,
        });
      }
      await this.auditLog.record(tx, {
        action: 'sales_return.create',
        entityType: 'sales_return',
        entityId: ret!.id,
        after: {
          code,
          customerId: input.customerId,
          invoiceId: input.invoiceId ?? null,
          total,
          items: lines.length,
        },
      });
      return ret!.id;
    });
    return this.get(user, branchId, id);
  }

  /** Chỉ sửa được ghi chú. */
  async updateNote(
    user: AuthUser,
    branchId: string,
    id: string,
    note: string | null,
  ): Promise<SalesReturnDto> {
    const scope = await scopeOf(this.permissions, user, 'return.create');
    await this.db.transaction(async (tx) => {
      const [ret] = await tx
        .select()
        .from(salesReturns)
        .where(
          and(eq(salesReturns.id, id), eq(salesReturns.branchId, branchId)),
        )
        .for('update');
      if (!ret) throw notFound('phiếu trả hàng');
      await this.assertOwnInvoice(tx, scope, user, ret.invoiceId);
      await tx
        .update(salesReturns)
        .set({ note: note?.trim() || null, updatedAt: new Date() })
        .where(eq(salesReturns.id, id));
      await this.auditLog.record(tx, {
        action: 'sales_return.update',
        entityType: 'sales_return',
        entityId: id,
        before: { note: ret.note },
        after: { note: note?.trim() || null },
      });
    });
    return this.get(user, branchId, id);
  }

  /**
   * Hủy phiếu trả bằng bút toán đảo: trừ lại tồn của các dòng đã nhập lại kho (không đủ tồn → 422 STOCK_NOT_ENOUGH,
   * không hủy được) và cộng lại công nợ khách.
   */
  async cancel(
    user: AuthUser,
    branchId: string,
    id: string,
    reason: string | undefined,
  ): Promise<SalesReturnDto> {
    await this.db.transaction(async (tx) => {
      const [peek] = await tx
        .select({ customerId: salesReturns.customerId })
        .from(salesReturns)
        .where(
          and(eq(salesReturns.id, id), eq(salesReturns.branchId, branchId)),
        );
      if (!peek) throw notFound('phiếu trả hàng');
      await lockPartyBranch(tx, 'customer', peek.customerId, branchId);
      const [ret] = await tx
        .select()
        .from(salesReturns)
        .where(eq(salesReturns.id, id))
        .for('update');
      if (!ret || ret.status !== 'completed') {
        throw new AppError(422, 'INVALID_STATE', 'Phiếu trả hàng đã hủy rồi');
      }
      const items = await tx
        .select()
        .from(salesReturnItems)
        .where(eq(salesReturnItems.returnId, id));
      const now = new Date();
      const restocked = items.filter((l) => l.restock);
      if (restocked.length > 0) {
        await this.inventory.applyMovements(
          tx,
          restocked.map((l) => ({
            branchId,
            productId: l.productId,
            qtyDelta: dec(l.qty).negated().toFixed(3),
            refType: 'sales_return' as const,
            refId: id,
            refCode: ret.code,
            occurredAt: now,
            userId: user.id,
          })),
        );
      }
      if (dec(ret.total).gt(0)) {
        await tx.insert(debtLedger).values({
          branchId,
          partyType: 'customer',
          partyId: ret.customerId,
          entryType: 'adjustment',
          refType: 'sales_return',
          refId: id,
          refCode: ret.code,
          amount: dec(ret.total).toFixed(0),
          occurredAt: now,
          note: `Hủy phiếu trả hàng ${ret.code}`,
          createdBy: user.id,
        });
      }
      await tx
        .update(salesReturns)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancelReason: reason?.trim() || null,
          updatedAt: now,
        })
        .where(eq(salesReturns.id, id));
      await this.auditLog.record(tx, {
        action: 'sales_return.cancel',
        entityType: 'sales_return',
        entityId: id,
        before: { status: 'completed', total: ret.total },
        after: { status: 'cancelled', reason: reason?.trim() || null },
      });
    });
    return this.get(user, branchId, id);
  }

  async exportXlsx(
    user: AuthUser,
    branchId: string,
    q: ListSalesReturnsQueryDto,
  ): Promise<Buffer> {
    const { data, itemsById } = await this.list(user, branchId, q, 'export');
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
          d.invoice?.code ?? null,
          d.seller?.fullName ?? null,
          d.customer.code,
          d.customer.name,
          d.receivedBy?.fullName ?? null,
          d.createdBy?.fullName ?? null,
          d.note,
          Number(d.total),
          Number(d.total),
          Number(d.total),
          0,
          0,
          STATUS_LABEL[d.status],
          it.code,
          it.name,
          it.note,
          Number(it.qty),
          Number(it.returnPrice),
          it.restockPrice === null ? null : Number(it.restockPrice),
        ]);
      }
    }
    return writeSheet(
      'Chi tiết trả hàng',
      [
        'Chi nhánh',
        'Mã trả hàng',
        'Thời gian',
        'Thời gian tạo',
        'Mã hóa đơn',
        'Người bán',
        'Mã khách hàng',
        'Tên khách hàng',
        'Người nhận trả',
        'Người tạo',
        'Ghi chú',
        'Tổng tiền hàng trả',
        'Tổng sau giảm giá',
        'Cần trả khách',
        'Tiền mặt',
        'Chuyển khoản',
        'Trạng thái',
        'Mã hàng',
        'Tên hàng',
        'Ghi chú hàng hóa',
        'Số lượng',
        'Giá bán',
        'Giá nhập lại',
      ].map((header) => ({ header })),
      rows,
    );
  }

  // ---------------------------------------------------------------- nội bộ

  /**
   * Hóa đơn gốc: khóa FOR UPDATE; phải hoàn tất, cùng chi nhánh và khách; quyền "chỉ của mình" → hóa đơn của mình; mỗi
   * mặt hàng tổng trả (các phiếu hoàn tất + phiếu này) không vượt tổng đã bán.
   */
  private async checkInvoice(
    tx: DbOrTx,
    user: AuthUser,
    scope: Awaited<ReturnType<typeof scopeOf>>,
    branchId: string,
    input: CreateSalesReturnDto,
    lines: Array<{ productId: string; qty: string; returnPrice: string }>,
  ) {
    const [inv] = await tx
      .select()
      .from(invoices)
      .where(
        and(eq(invoices.id, input.invoiceId!), eq(invoices.branchId, branchId)),
      )
      .for('update');
    if (!inv) throw notFound('hóa đơn');
    if (inv.status !== 'completed') {
      throw new AppError(422, 'INVALID_STATE', 'Hóa đơn đã hủy, không trả hàng được');
    }
    if (inv.customerId !== input.customerId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Khách không khớp hóa đơn gốc', [
        { field: 'customerId', message: 'Khách phải là khách của hóa đơn gốc' },
      ]);
    }
    if (scope === 'own' && inv.sellerId !== user.id) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Bạn chỉ được trả hàng cho hóa đơn do chính mình bán',
        { permission: 'return.create' },
      );
    }
    const sold = new Map<string, ReturnType<typeof dec>>();
    for (const r of await tx
      .select({
        id: invoiceItems.productId,
        qty: sql<string>`sum(${invoiceItems.qty})`,
      })
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, inv.id))
      .groupBy(invoiceItems.productId)) {
      sold.set(r.id, dec(r.qty));
    }
    const returned = new Map<string, ReturnType<typeof dec>>();
    for (const r of await tx
      .select({
        id: salesReturnItems.productId,
        qty: sql<string>`sum(${salesReturnItems.qty})`,
      })
      .from(salesReturnItems)
      .innerJoin(salesReturns, eq(salesReturns.id, salesReturnItems.returnId))
      .where(
        and(
          eq(salesReturns.invoiceId, inv.id),
          eq(salesReturns.status, 'completed'),
        ),
      )
      .groupBy(salesReturnItems.productId)) {
      returned.set(r.id, dec(r.qty));
    }
    const asking = new Map<string, ReturnType<typeof dec>>();
    for (const l of lines) {
      asking.set(l.productId, (asking.get(l.productId) ?? dec(0)).plus(dec(l.qty)));
    }
    // Giá trả tối đa mỗi mặt hàng = giá bán thực của dòng (đã trừ phần giảm giá phiếu chia theo tỷ lệ tiền dòng),
    // để trả hàng không làm nợ khách giảm nhiều hơn số khách thực phải trả.
    const itemRows = await tx
      .select({
        productId: invoiceItems.productId,
        qty: invoiceItems.qty,
        lineTotal: invoiceItems.lineTotal,
      })
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, inv.id))
      .orderBy(invoiceItems.lineNo);
    const shares = allocateProportionally(
      inv.discount,
      itemRows.map((r) => r.lineTotal),
    );
    const maxPrice = new Map<string, ReturnType<typeof dec>>();
    itemRows.forEach((r, i) => {
      const unit = dec(r.lineTotal)
        .minus(dec(shares[i]!))
        .div(dec(r.qty))
        .ceil();
      const cur = maxPrice.get(r.productId);
      if (!cur || unit.gt(cur)) maxPrice.set(r.productId, unit);
    });
    const details: Array<{ field: string; message: string }> = [];
    const priceDetails: Array<{ field: string; message: string }> = [];
    lines.forEach((l, i) => {
      const cap = maxPrice.get(l.productId);
      if (cap && dec(l.returnPrice).gt(cap)) {
        priceDetails.push({
          field: `items.${i}.returnPrice`,
          message: `Giá trả không được vượt giá bán thực của hóa đơn (${cap.toFixed(0)})`,
        });
      }
    });
    if (priceDetails.length > 0) {
      throw new AppError(
        422,
        'RETURN_PRICE_EXCEEDED',
        'Giá trả vượt giá bán của hóa đơn gốc',
        priceDetails,
      );
    }
    lines.forEach((l, i) => {
      const left = (sold.get(l.productId) ?? dec(0)).minus(
        returned.get(l.productId) ?? dec(0),
      );
      if (asking.get(l.productId)!.gt(left)) {
        details.push({
          field: `items.${i}.qty`,
          message: sold.has(l.productId)
            ? `Chỉ còn trả được ${left.toFixed(3)} (đã bán ${sold.get(l.productId)!.toFixed(3)}, đã trả ${(returned.get(l.productId) ?? dec(0)).toFixed(3)})`
            : 'Hàng này không có trong hóa đơn gốc',
        });
      }
    });
    if (details.length > 0) {
      throw new AppError(
        422,
        'RETURN_QTY_EXCEEDED',
        'Số lượng trả vượt số đã bán của hóa đơn gốc',
        details,
      );
    }
  }

  /** Quyền "chỉ của mình": phiếu phải gắn hóa đơn do mình bán. */
  private async assertOwnInvoice(
    tx: DbOrTx,
    scope: Awaited<ReturnType<typeof scopeOf>>,
    user: AuthUser,
    invoiceId: string | null,
  ) {
    if (scope !== 'own') return;
    let mine = false;
    if (invoiceId) {
      const [inv] = await tx
        .select({ sellerId: invoices.sellerId })
        .from(invoices)
        .where(eq(invoices.id, invoiceId));
      mine = inv?.sellerId === user.id;
    }
    if (!mine) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Bạn chỉ được sửa phiếu trả hàng của hóa đơn do chính mình bán',
        { permission: 'return.create' },
      );
    }
  }

  private headers(db: DbOrTx, where: SQL | undefined) {
    return db
      .select({
        r: salesReturns,
        cCode: customers.code,
        cName: customers.name,
        cPhone: customers.phone,
        iCode: invoices.code,
        sellerId: invoices.sellerId,
        sellerName: invSeller.fullName,
        receiverName: receiver.fullName,
        creatorName: creator.fullName,
      })
      .from(salesReturns)
      .innerJoin(customers, eq(customers.id, salesReturns.customerId))
      .leftJoin(invoices, eq(invoices.id, salesReturns.invoiceId))
      .leftJoin(invSeller, eq(invSeller.id, invoices.sellerId))
      .leftJoin(receiver, eq(receiver.id, salesReturns.receivedBy))
      .leftJoin(creator, eq(creator.id, salesReturns.createdBy))
      .where(where);
  }

  private async itemsOf(db: DbOrTx, ids: string[]) {
    const out = new Map<string, SalesReturnItemDto[]>();
    if (ids.length === 0) return out;
    const lines = await db
      .select({
        returnId: salesReturnItems.returnId,
        productId: salesReturnItems.productId,
        code: products.code,
        name: products.name,
        qty: salesReturnItems.qty,
        returnPrice: salesReturnItems.returnPrice,
        restockPrice: salesReturnItems.restockPrice,
        restock: salesReturnItems.restock,
        lineTotal: salesReturnItems.lineTotal,
        note: salesReturnItems.note,
      })
      .from(salesReturnItems)
      .innerJoin(products, eq(products.id, salesReturnItems.productId))
      .where(inArray(salesReturnItems.returnId, ids))
      .orderBy(asc(products.code), asc(salesReturnItems.id));
    for (const l of lines) {
      const list = out.get(l.returnId) ?? [];
      list.push({
        productId: l.productId,
        code: l.code,
        name: l.name,
        qty: dec(l.qty).toFixed(3),
        returnPrice: dec(l.returnPrice).toFixed(0),
        restockPrice:
          l.restockPrice === null ? null : dec(l.restockPrice).toFixed(0),
        restock: l.restock,
        lineTotal: dec(l.lineTotal).toFixed(0),
        note: l.note,
      });
      out.set(l.returnId, list);
    }
    return out;
  }

  private toDto(
    row: {
      r: ReturnRow;
      cCode: string;
      cName: string;
      cPhone: string | null;
      iCode: string | null;
      sellerId: string | null;
      sellerName: string | null;
      receiverName: string | null;
      creatorName: string | null;
    },
    items: SalesReturnItemDto[],
    withItems: boolean,
  ): SalesReturnDto {
    const r = row.r;
    const person = (id: string | null, name: string | null) =>
      id && name ? { id, fullName: name } : null;
    return {
      id: r.id,
      code: r.code,
      status: r.status,
      branchId: r.branchId,
      customer: { id: r.customerId, code: row.cCode, name: row.cName, phone: row.cPhone },
      invoice: r.invoiceId && row.iCode ? { id: r.invoiceId, code: row.iCode } : null,
      seller: person(row.sellerId, row.sellerName),
      returnedAt: r.returnedAt.toISOString(),
      receivedBy: person(r.receivedBy, row.receiverName),
      total: dec(r.total).toFixed(0),
      ...summarizeLines(items),
      note: r.note,
      createdBy: person(r.createdBy, row.creatorName),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
      cancelReason: r.cancelReason,
      ...(withItems ? { items } : {}),
    };
  }
}
