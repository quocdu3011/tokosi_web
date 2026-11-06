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
import { dec } from '../../common/costing.js';
import { writeSheet, type CellValue } from '../../common/excel.js';
import { pageMeta, pageParams, parseSort } from '../../common/pagination.js';
import { formatVnDateTime } from '../../common/vn-date.js';
import { nextFreeDocumentCode } from '../../db/code-sequence.js';
import { DB, type Database, type DbOrTx } from '../../db/database.module.js';
import {
  branches,
  cashAccounts,
  cashCategories,
  cashTransactions,
  customers,
  debtLedger,
  invoiceItems,
  invoicePayments,
  invoices,
  orders,
  paymentAllocations,
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
import { OrdersService, saleSearch } from './orders.service.js';
import {
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
  INVOICE_SORT_FIELDS,
  type CreateInvoiceDto,
  type InvoiceDto,
  type InvoiceFromOrderDto,
  type InvoiceItemDto,
  type InvoicePaymentDto,
  type ListInvoicesQueryDto,
  type PaymentInputDto,
  type SaleInvoiceStatus,
} from './sales.dto.js';

const STATUS_LABEL: Record<SaleInvoiceStatus, string> = {
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
};
const seller = alias(users, 'seller');
const creator = alias(users, 'creator');
type InvoiceRow = typeof invoices.$inferSelect;

interface Issue {
  user: AuthUser;
  branchId: string;
  customerId: string;
  sellerId: string;
  invoicedAt: Date;
  lines: PricedSaleLine[];
  subtotal: string;
  discount: string;
  total: string;
  note: string | null;
  orderId: string | null;
  payments: PaymentInputDto[];
}

/**
 * Hóa đơn bán: trừ kho (giá vốn lúc bán lưu trên dòng), ghi nợ khách theo chi nhánh, ghi phiếu thu cho phần thanh toán
 * lúc xuất. Một transaction. Thứ tự khóa: nợ khách+chi nhánh (advisory) → phiếu đặt (FOR UPDATE) → dòng tồn
 * (`applyMovements`, thứ tự cố định). Hóa đơn hoàn tất KHÔNG sửa (trừ ghi chú): hủy bằng bút toán đảo rồi lập lại.
 */
@Injectable()
export class InvoicesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly auditLog: AuditService,
    private readonly permissions: PermissionsService,
    private readonly inventory: InventoryService,
    private readonly orders: OrdersService,
  ) {}

  async list(
    user: AuthUser,
    branchId: string,
    q: ListInvoicesQueryDto,
    mode: 'page' | 'export' = 'page',
  ) {
    const own = (await scopeOf(this.permissions, user, 'invoice.view')) === 'own';
    const { start, endExclusive } = dayRange(q.from, q.to);
    const debtLeft = sql`${invoices.total} - ${invoices.paidTotal}`;
    const where = and(
      eq(invoices.branchId, branchId),
      own ? eq(invoices.sellerId, user.id) : undefined,
      saleSearch(invoices.code, q.q),
      q.customerId ? eq(invoices.customerId, q.customerId) : undefined,
      q.sellerId ? eq(invoices.sellerId, q.sellerId) : undefined,
      q.orderId ? eq(invoices.orderId, q.orderId) : undefined,
      q.status ? eq(invoices.status, q.status) : undefined,
      q.hasDebt === undefined
        ? undefined
        : and(
            eq(invoices.status, 'completed'),
            q.hasDebt ? sql`${debtLeft} > 0` : sql`${debtLeft} <= 0`,
          ),
      start ? gte(invoices.invoicedAt, start) : undefined,
      endExclusive ? lt(invoices.invoicedAt, endExclusive) : undefined,
    );
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .where(where);
    const sort = parseSort(q.sort, INVOICE_SORT_FIELDS);
    const dir = sort?.desc === false ? asc : desc;
    const sortCol =
      sort?.field === 'code'
        ? invoices.code
        : sort?.field === 'total'
          ? invoices.total
          : invoices.invoicedAt;
    const { page, limit, offset } =
      mode === 'export'
        ? { page: 1, limit: DOC_EXPORT_MAX_ROWS, offset: 0 }
        : pageParams(q);
    const rows = await this.headers(this.db, where)
      .orderBy(dir(sortCol), desc(invoices.id))
      .limit(limit)
      .offset(offset);
    const ids = rows.map((r) => r.r.id);
    const canCost = await this.permissions.has(user.role, 'product.cost.view');
    const items = await this.itemsOf(this.db, ids, canCost);
    return {
      data: rows.map((r) => this.toDto(r, items.get(r.r.id) ?? [], false)),
      meta: pageMeta(page, limit, total),
      itemsById: items,
      customerAddress: new Map(rows.map((r) => [r.r.id, r.cAddress])),
    };
  }

  async get(user: AuthUser, branchId: string, id: string): Promise<InvoiceDto> {
    const own = (await scopeOf(this.permissions, user, 'invoice.view')) === 'own';
    const [row] = await this.headers(
      this.db,
      and(
        eq(invoices.id, id),
        eq(invoices.branchId, branchId),
        own ? eq(invoices.sellerId, user.id) : undefined,
      ),
    );
    if (!row) throw notFound('hóa đơn');
    const canCost = await this.permissions.has(user.role, 'product.cost.view');
    const items = (await this.itemsOf(this.db, [id], canCost)).get(id) ?? [];
    const dto = this.toDto(row, items, true);
    dto.payments = await this.paymentsOf(this.db, id);
    if (canCost) {
      const cost = items.reduce(
        (s, i) => s.plus(dec(i.qty).times(dec(i.unitCost ?? '0'))),
        dec(0),
      );
      dto.grossProfit = dec(row.r.total).minus(cost).toFixed(0);
    }
    return dto;
  }

  /** Tạo hóa đơn trực tiếp, không qua phiếu đặt hàng. */
  async create(
    user: AuthUser,
    branchId: string,
    input: CreateInvoiceDto,
  ): Promise<InvoiceDto> {
    const scope = await scopeOf(this.permissions, user, 'invoice.create');
    const invoicedAt = resolveTime(input.invoicedAt, 'invoicedAt');
    const { id, warnings } = await this.db.transaction(async (tx) => {
      // Khóa nợ khách+chi nhánh ĐẦU TIÊN, rồi mới đọc số dư để cảnh báo hạn mức
      await lockPartyBranch(tx, 'customer', input.customerId, branchId);
      await loadCustomer(tx, input.customerId, true);
      const sellerId = await resolvePerson(
        tx,
        sellerFor(scope, user, input.sellerId, 'invoice.create'),
        user.id,
        branchId,
        'sellerId',
      );
      const priced = priceSaleLines(input.items, input.discount);
      return this.issue(tx, {
        user,
        branchId,
        customerId: input.customerId,
        sellerId,
        invoicedAt,
        lines: priced.lines,
        subtotal: priced.subtotal,
        discount: priced.discount,
        total: priced.total,
        note: input.note?.trim() || null,
        orderId: null,
        payments: input.payments ?? [],
      });
    });
    const dto = await this.get(user, branchId, id);
    dto.warnings = warnings;
    return dto;
  }

  /** Xuất hóa đơn từ phiếu tạm: lấy đúng dòng hàng, giảm giá, người bán của phiếu; phiếu → hoàn thành. */
  async createFromOrder(
    user: AuthUser,
    branchId: string,
    orderId: string,
    input: InvoiceFromOrderDto,
  ): Promise<InvoiceDto> {
    const scope = await scopeOf(this.permissions, user, 'invoice.create');
    const invoicedAt = resolveTime(input.invoicedAt, 'invoicedAt');
    const { id, warnings } = await this.db.transaction(async (tx) => {
      const [peek] = await tx
        .select({ customerId: orders.customerId })
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.branchId, branchId)));
      if (!peek) throw notFound('phiếu đặt hàng');
      await lockPartyBranch(tx, 'customer', peek.customerId, branchId);
      const order = await this.orders.lockOrder(tx, orderId, branchId);
      if (order.customerId !== peek.customerId) {
        throw new AppError(
          409,
          'INVALID_STATE',
          'Phiếu vừa bị đổi khách, hãy thử lại',
        );
      }
      if (scope === 'own' && order.sellerId !== user.id) {
        throw new AppError(
          403,
          'FORBIDDEN',
          'Bạn chỉ được xuất hóa đơn cho phiếu do chính mình bán',
          { permission: 'invoice.create' },
        );
      }
      if (order.status !== 'draft') {
        throw new AppError(
          422,
          'INVALID_STATE',
          order.status === 'completed'
            ? 'Phiếu đã xuất hóa đơn rồi'
            : 'Phiếu đã hủy, không xuất hóa đơn được',
        );
      }
      await loadCustomer(tx, order.customerId, true);
      const lines = await this.orders.linesOf(tx, orderId);
      const result = await this.issue(tx, {
        user,
        branchId,
        customerId: order.customerId,
        sellerId: order.sellerId ?? user.id,
        invoicedAt,
        lines: lines.map((l, i) => ({ ...l, lineNo: i + 1 })),
        subtotal: dec(order.subtotal).toFixed(0),
        discount: dec(order.discount).toFixed(0),
        total: dec(order.total).toFixed(0),
        note: input.note !== undefined ? input.note?.trim() || null : order.note,
        orderId,
        payments: input.payments ?? [],
      });
      await tx
        .update(orders)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(orders.id, orderId));
      return result;
    });
    const dto = await this.get(user, branchId, id);
    dto.warnings = warnings;
    return dto;
  }

  /** Chỉ sửa được ghi chú (hóa đơn hoàn tất không sửa; hủy rồi lập lại). */
  async updateNote(
    user: AuthUser,
    branchId: string,
    id: string,
    note: string | null,
  ): Promise<InvoiceDto> {
    const scope = await scopeOf(this.permissions, user, 'invoice.create');
    await this.db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, id), eq(invoices.branchId, branchId)))
        .for('update');
      if (!inv) throw notFound('hóa đơn');
      if (scope === 'own' && inv.sellerId !== user.id) {
        throw new AppError(403, 'FORBIDDEN', 'Bạn chỉ được sửa hóa đơn do chính mình bán', {
          permission: 'invoice.create',
        });
      }
      await tx
        .update(invoices)
        .set({ note: note?.trim() || null, updatedAt: new Date() })
        .where(eq(invoices.id, id));
      await this.auditLog.record(tx, {
        action: 'invoice.update',
        entityType: 'invoice',
        entityId: id,
        before: { note: inv.note },
        after: { note: note?.trim() || null },
      });
    });
    return this.get(user, branchId, id);
  }

  /**
   * Hủy hóa đơn bằng bút toán đảo: cộng lại tồn (đúng giá vốn đã xuất), đảo công nợ, hủy các phiếu thu lúc xuất; phiếu
   * đặt hàng gốc (nếu có) trở về phiếu tạm để sửa và xuất lại. Không hủy được khi đã có phiếu trả hàng hoặc đã cấn trừ
   * thu nợ.
   */
  async cancel(
    user: AuthUser,
    branchId: string,
    id: string,
    reason: string,
  ): Promise<InvoiceDto> {
    const trimmed = reason.trim();
    if (!trimmed) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Cần nhập lý do hủy', [
        { field: 'reason', message: 'Bắt buộc nhập lý do hủy hóa đơn' },
      ]);
    }
    await this.db.transaction(async (tx) => {
      const [peek] = await tx
        .select({ customerId: invoices.customerId })
        .from(invoices)
        .where(and(eq(invoices.id, id), eq(invoices.branchId, branchId)));
      if (!peek) throw notFound('hóa đơn');
      await lockPartyBranch(tx, 'customer', peek.customerId, branchId);
      const [inv] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, id))
        .for('update');
      if (!inv || inv.status !== 'completed') {
        throw new AppError(422, 'INVALID_STATE', 'Hóa đơn đã hủy rồi');
      }
      const [ret] = await tx
        .select({ code: salesReturns.code })
        .from(salesReturns)
        .where(
          and(
            eq(salesReturns.invoiceId, id),
            eq(salesReturns.status, 'completed'),
          ),
        );
      if (ret) {
        throw new AppError(
          409,
          'INVALID_STATE',
          `Hóa đơn đã có phiếu trả hàng ${ret.code}, hãy hủy phiếu trả trước`,
        );
      }
      const [alloc] = await tx
        .select({ id: paymentAllocations.id })
        .from(paymentAllocations)
        .where(eq(paymentAllocations.invoiceId, id));
      if (alloc) {
        throw new AppError(
          409,
          'INVALID_STATE',
          'Hóa đơn đã được cấn trừ thu nợ, hãy hủy các phiếu thu liên quan trước',
        );
      }
      const items = await tx
        .select()
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, id))
        .orderBy(asc(invoiceItems.lineNo));
      const pays = await tx
        .select()
        .from(invoicePayments)
        .where(eq(invoicePayments.invoiceId, id));
      const now = new Date();
      await this.inventory.applyMovements(
        tx,
        items.map((l) => ({
          branchId,
          productId: l.productId,
          qtyDelta: dec(l.qty).toFixed(3),
          unitCost: l.unitCost,
          refType: 'invoice' as const,
          refId: id,
          refCode: inv.code,
          occurredAt: now,
          userId: user.id,
        })),
      );
      if (dec(inv.total).gt(0)) {
        await tx.insert(debtLedger).values({
          branchId,
          partyType: 'customer',
          partyId: inv.customerId,
          entryType: 'adjustment',
          refType: 'invoice',
          refId: id,
          refCode: inv.code,
          amount: dec(inv.total).negated().toFixed(0),
          occurredAt: now,
          note: `Hủy hóa đơn ${inv.code}`,
          createdBy: user.id,
        });
      }
      for (const p of pays) {
        await tx.insert(debtLedger).values({
          branchId,
          partyType: 'customer',
          partyId: inv.customerId,
          entryType: 'adjustment',
          refType: 'invoice',
          refId: id,
          refCode: inv.code,
          amount: dec(p.amount).toFixed(0),
          occurredAt: now,
          note: `Hoàn khoản thu lúc xuất hóa đơn ${inv.code}`,
          createdBy: user.id,
        });
        if (p.cashTransactionId) {
          await tx
            .update(cashTransactions)
            .set({
              status: 'cancelled',
              cancelledAt: now,
              cancelReason: `Hủy hóa đơn ${inv.code}: ${trimmed}`,
              updatedAt: now,
            })
            .where(eq(cashTransactions.id, p.cashTransactionId));
        }
      }
      await tx
        .update(invoices)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancelReason: trimmed,
          updatedAt: now,
        })
        .where(eq(invoices.id, id));
      if (inv.orderId) {
        await tx
          .update(orders)
          .set({ status: 'draft', updatedAt: now })
          .where(eq(orders.id, inv.orderId));
      }
      await this.auditLog.record(tx, {
        action: 'invoice.cancel',
        entityType: 'invoice',
        entityId: id,
        before: { status: 'completed', total: inv.total, paid: inv.paidTotal },
        after: { status: 'cancelled', reason: trimmed },
      });
    });
    return this.get(user, branchId, id);
  }

  async exportXlsx(
    user: AuthUser,
    branchId: string,
    q: ListInvoicesQueryDto,
  ): Promise<Buffer> {
    const { data, itemsById, customerAddress } = await this.list(
      user,
      branchId,
      q,
      'export',
    );
    const ids = data.map((d) => d.id);
    const paid = new Map<string, { cash: number; bank: number }>();
    if (ids.length > 0) {
      for (const p of await this.db
        .select()
        .from(invoicePayments)
        .where(inArray(invoicePayments.invoiceId, ids))) {
        const cur = paid.get(p.invoiceId) ?? { cash: 0, bank: 0 };
        cur[p.method] += Number(p.amount);
        paid.set(p.invoiceId, cur);
      }
    }
    const [branch] = await this.db
      .select({ name: branches.name })
      .from(branches)
      .where(eq(branches.id, branchId));
    const rows: CellValue[][] = [];
    for (const d of data) {
      const pm = paid.get(d.id) ?? { cash: 0, bank: 0 };
      for (const it of itemsById.get(d.id) ?? []) {
        rows.push([
          branch?.name ?? '',
          d.code,
          formatVnDateTime(d.invoicedAt),
          formatVnDateTime(d.createdAt),
          formatVnDateTime(d.updatedAt),
          d.order?.code ?? null,
          d.customer.code,
          d.customer.name,
          d.customer.phone,
          customerAddress.get(d.id) ?? null,
          d.seller?.fullName ?? null,
          d.createdBy?.fullName ?? null,
          d.note,
          Number(d.subtotal),
          Number(d.discount),
          Number(d.total),
          Number(d.paid),
          pm.cash,
          pm.bank,
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
      'Chi tiết hóa đơn',
      [
        'Chi nhánh',
        'Mã hóa đơn',
        'Thời gian',
        'Thời gian tạo',
        'Ngày cập nhật',
        'Mã đặt hàng',
        'Mã khách hàng',
        'Tên khách hàng',
        'Điện thoại',
        'Địa chỉ (Khách hàng)',
        'Người bán',
        'Người tạo',
        'Ghi chú',
        'Tổng tiền hàng',
        'Giảm giá hóa đơn',
        'Khách cần trả',
        'Khách đã trả',
        'Tiền mặt',
        'Chuyển khoản',
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

  /** Lõi xuất hóa đơn (đã giữ khóa nợ khách và khóa phiếu): kho → nợ → thu tiền. */
  private async issue(
    tx: DbOrTx,
    p: Issue,
  ): Promise<{ id: string; warnings: SaleWarning[] }> {
    const productIds = [...new Set(p.lines.map((l) => l.productId))];
    const prods = await loadLineProducts(tx, productIds, true);
    const paidTotal = await this.checkPayments(tx, p);
    const debtAdded = dec(p.total).minus(dec(paidTotal)).toFixed(0);

    // Cảnh báo mềm (tính TRƯỚC khi ghi sổ): vượt có thể bán, vượt hạn mức
    const warnings = await stockWarnings(tx, p.branchId, p.lines, prods, p.orderId ?? undefined);
    const credit = await creditWarning(tx, p.customerId, p.branchId, debtAdded);
    if (credit) warnings.push(credit);

    const code = await nextFreeDocumentCode(tx, DOCUMENT_PREFIX.invoice, async (c) => {
      const [hit] = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(sql`lower(${invoices.code}) = lower(${c})`);
      return hit !== undefined;
    });
    const [inv] = await tx
      .insert(invoices)
      .values({
        code,
        branchId: p.branchId,
        orderId: p.orderId,
        customerId: p.customerId,
        sellerId: p.sellerId,
        invoicedAt: p.invoicedAt,
        subtotal: p.subtotal,
        discount: p.discount,
        total: p.total,
        paidTotal,
        status: 'completed',
        note: p.note,
        createdBy: p.user.id,
      })
      .returning();
    const id = inv!.id;

    // Kho: trừ tồn (applyMovements khóa theo thứ tự cố định → không bế tắc); thiếu tồn thực tế → 422
    const moves = await this.inventory.applyMovements(
      tx,
      p.lines.map((l) => ({
        branchId: p.branchId,
        productId: l.productId,
        qtyDelta: dec(l.qty).negated().toFixed(3),
        refType: 'invoice' as const,
        refId: id,
        refCode: code,
        occurredAt: p.invoicedAt,
        userId: p.user.id,
      })),
    );
    await tx.insert(invoiceItems).values(
      p.lines.map((l, i) => ({
        invoiceId: id,
        lineNo: l.lineNo,
        productId: l.productId,
        productCode: prods.get(l.productId)!.code,
        productName: prods.get(l.productId)!.name,
        qty: l.qty,
        discountPerUnit: l.discountPerUnit,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        unitCost: moves[i]!.movementCost,
        note: l.note,
      })),
    );

    // Công nợ khách tại chi nhánh: +total, rồi −từng khoản thu
    if (dec(p.total).gt(0)) {
      await tx.insert(debtLedger).values({
        branchId: p.branchId,
        partyType: 'customer',
        partyId: p.customerId,
        entryType: 'invoice',
        refType: 'invoice',
        refId: id,
        refCode: code,
        amount: p.total,
        occurredAt: p.invoicedAt,
        createdBy: p.user.id,
      });
    }
    if (p.payments.length > 0) {
      const [cat] = await tx
        .select({ id: cashCategories.id })
        .from(cashCategories)
        .where(eq(cashCategories.code, 'customer_payment'));
      if (!cat) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Thiếu danh mục thu "Tiền khách trả"');
      }
      for (const pay of p.payments) {
        const cashCode = await nextFreeDocumentCode(tx, DOCUMENT_PREFIX.cashIn, async (c) => {
          const [hit] = await tx
            .select({ id: cashTransactions.id })
            .from(cashTransactions)
            .where(sql`lower(${cashTransactions.code}) = lower(${c})`);
          return hit !== undefined;
        });
        const [cash] = await tx
          .insert(cashTransactions)
          .values({
            code: cashCode,
            branchId: p.branchId,
            direction: 'in',
            amount: pay.amount,
            categoryId: cat.id,
            accountId: pay.accountId,
            occurredAt: p.invoicedAt,
            partyType: 'customer',
            partyId: p.customerId,
            refType: 'invoice',
            refId: id,
            status: 'completed',
            note: `Thu tiền hóa đơn ${code}`,
            createdBy: p.user.id,
          })
          .returning();
        await tx.insert(invoicePayments).values({
          invoiceId: id,
          method: pay.method,
          accountId: pay.accountId,
          amount: pay.amount,
          paidAt: p.invoicedAt,
          cashTransactionId: cash!.id,
        });
        await tx.insert(debtLedger).values({
          branchId: p.branchId,
          partyType: 'customer',
          partyId: p.customerId,
          entryType: 'payment',
          refType: 'invoice',
          refId: id,
          refCode: code,
          amount: dec(pay.amount).negated().toFixed(0),
          occurredAt: p.invoicedAt,
          createdBy: p.user.id,
        });
      }
    }
    await this.auditLog.record(tx, {
      action: 'invoice.create',
      entityType: 'invoice',
      entityId: id,
      after: {
        code,
        customerId: p.customerId,
        orderId: p.orderId,
        total: p.total,
        paid: paidTotal,
        items: p.lines.length,
      },
    });
    return { id, warnings };
  }

  /** Kiểm tra các khoản thu lúc xuất; trả tổng đã thu. */
  private async checkPayments(tx: DbOrTx, p: Issue): Promise<string> {
    if (p.payments.length === 0) return '0';
    const sum = p.payments.reduce((s, x) => s.plus(dec(x.amount)), dec(0));
    if (sum.gt(dec(p.total))) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Tổng tiền thu vượt số khách cần trả', [
        {
          field: 'payments',
          message: `Tổng thu ${sum.toFixed(0)} lớn hơn khách cần trả ${p.total}`,
        },
      ]);
    }
    const ids = [...new Set(p.payments.map((x) => x.accountId))];
    const accounts = new Map(
      (
        await tx
          .select()
          .from(cashAccounts)
          .where(inArray(cashAccounts.id, ids))
      ).map((a) => [a.id, a]),
    );
    p.payments.forEach((x, i) => {
      const a = accounts.get(x.accountId);
      const bad = (message: string) =>
        new AppError(400, 'VALIDATION_ERROR', 'Quỹ nhận tiền không hợp lệ', [
          { field: `payments.${i}.accountId`, message },
        ]);
      if (!a) throw bad('Quỹ không tồn tại');
      if (a.branchId !== p.branchId) throw bad('Quỹ không thuộc chi nhánh làm việc');
      if (!a.isActive) throw bad('Quỹ đã ngưng sử dụng');
      if (a.type !== x.method) throw bad('Loại quỹ không khớp phương thức thanh toán');
    });
    return sum.toFixed(0);
  }

  private headers(db: DbOrTx, where: SQL | undefined) {
    return db
      .select({
        r: invoices,
        cCode: customers.code,
        cName: customers.name,
        cPhone: customers.phone,
        cAddress: customers.address,
        oCode: orders.code,
        sellerName: seller.fullName,
        creatorName: creator.fullName,
      })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .leftJoin(orders, eq(orders.id, invoices.orderId))
      .leftJoin(seller, eq(seller.id, invoices.sellerId))
      .leftJoin(creator, eq(creator.id, invoices.createdBy))
      .where(where);
  }

  private async itemsOf(db: DbOrTx, ids: string[], withCost: boolean) {
    const out = new Map<string, InvoiceItemDto[]>();
    if (ids.length === 0) return out;
    const lines = await db
      .select()
      .from(invoiceItems)
      .where(inArray(invoiceItems.invoiceId, ids))
      .orderBy(asc(invoiceItems.lineNo), asc(invoiceItems.id));
    for (const l of lines) {
      const list = out.get(l.invoiceId) ?? [];
      list.push({
        lineNo: l.lineNo,
        productId: l.productId,
        code: l.productCode,
        name: l.productName,
        qty: dec(l.qty).toFixed(3),
        price: dec(l.unitPrice).plus(dec(l.discountPerUnit)).toFixed(0),
        discountPerUnit: dec(l.discountPerUnit).toFixed(0),
        unitPrice: dec(l.unitPrice).toFixed(0),
        lineTotal: dec(l.lineTotal).toFixed(0),
        note: l.note,
        ...(withCost ? { unitCost: dec(l.unitCost).toFixed(4) } : {}),
      });
      out.set(l.invoiceId, list);
    }
    return out;
  }

  private async paymentsOf(db: DbOrTx, id: string): Promise<InvoicePaymentDto[]> {
    const rows = await db
      .select({
        p: invoicePayments,
        accountName: cashAccounts.name,
        cashCode: cashTransactions.code,
      })
      .from(invoicePayments)
      .innerJoin(cashAccounts, eq(cashAccounts.id, invoicePayments.accountId))
      .leftJoin(
        cashTransactions,
        eq(cashTransactions.id, invoicePayments.cashTransactionId),
      )
      .where(eq(invoicePayments.invoiceId, id))
      .orderBy(
        asc(invoicePayments.paidAt),
        asc(cashTransactions.code), // mã TT tăng dần theo thứ tự ghi
        asc(invoicePayments.id),
      );
    return rows.map(({ p, accountName, cashCode }) => ({
      method: p.method,
      accountId: p.accountId,
      accountName,
      amount: dec(p.amount).toFixed(0),
      paidAt: p.paidAt.toISOString(),
      cashCode,
    }));
  }

  private toDto(
    row: {
      r: InvoiceRow;
      cCode: string;
      cName: string;
      cPhone: string | null;
      oCode: string | null;
      sellerName: string | null;
      creatorName: string | null;
    },
    items: InvoiceItemDto[],
    withItems: boolean,
  ): InvoiceDto {
    const r = row.r;
    const person = (id: string | null, name: string | null) =>
      id && name ? { id, fullName: name } : null;
    return {
      id: r.id,
      code: r.code,
      status: r.status,
      branchId: r.branchId,
      order: r.orderId && row.oCode ? { id: r.orderId, code: row.oCode } : null,
      customer: { id: r.customerId, code: row.cCode, name: row.cName, phone: row.cPhone },
      seller: person(r.sellerId, row.sellerName),
      invoicedAt: r.invoicedAt.toISOString(),
      subtotal: dec(r.subtotal).toFixed(0),
      discount: dec(r.discount).toFixed(0),
      total: dec(r.total).toFixed(0),
      paid: dec(r.paidTotal).toFixed(0),
      debt: dec(r.total).minus(dec(r.paidTotal)).toFixed(0),
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
