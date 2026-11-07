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
  isNull,
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
import { searchWhere } from '../../db/search.js';
import {
  cashAccounts,
  cashCategories,
  cashTransactions,
  customers,
  debtLedger,
  invoices,
  paymentAllocations,
  suppliers,
  users,
} from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';
import { DOC_EXPORT_MAX_ROWS } from '../purchasing/goods-receipts.service.js';
import {
  dayRange,
  notFound,
  resolveTime,
} from '../purchasing/purchase-lines.js';
import { outstandingExpr } from '../sales/invoice-balance.js';
import { CashAccountsService } from './cash-accounts.service.js';
import {
  CASH_SORT_FIELDS,
  type CashAllocationDto,
  type CashPartyType,
  type CashSummaryDto,
  type CashTransactionDto,
  type CashWarningDto,
  type CreateCashTransactionDto,
  type CreateCustomerReceiptDto,
  type ListCashTransactionsQueryDto,
} from './cash-transactions.dto.js';

/**
 * Danh mục hệ thống QUYẾT ĐỊNH phiếu có ghi công nợ hay không (theo `cash_categories.code`, không theo tên).
 * `sign`: dấu ghi vào `debt_ledger` (− giảm nợ, + tăng nợ).
 */
const DEBT_EFFECT: Record<string, { party: 'customer' | 'supplier'; sign: 1 | -1 }> = {
  customer_payment: { party: 'customer', sign: -1 },
  customer_refund: { party: 'customer', sign: 1 },
  supplier_payment: { party: 'supplier', sign: -1 },
  supplier_refund: { party: 'supplier', sign: 1 },
};
const PARTY_LABEL = { customer: 'khách hàng', supplier: 'nhà cung cấp', employee: 'nhân viên' };
const STATUS_LABEL = { completed: 'Đã thanh toán', cancelled: 'Đã hủy' };
const creator = alias(users, 'creator');
const employee = alias(users, 'employee_party');

type TxRow = typeof cashTransactions.$inferSelect;
interface Party {
  type: CashPartyType;
  id: string;
  code: string | null;
  name: string;
}

/**
 * Phiếu thu/chi. Phiếu đã tạo KHÔNG sửa (trừ ghi chú), chỉ hủy (bút toán đảo). Danh mục hệ thống ghi công nợ cùng
 * transaction; thu nợ khách cấn trừ vào hóa đơn còn nợ cũ nhất (hoặc theo danh sách chọn tay). Thứ tự khóa: nợ đối tác
 * + chi nhánh (advisory) → dòng quỹ (FOR SHARE) → các hóa đơn cấn trừ (FOR UPDATE, theo id).
 */
@Injectable()
export class CashTransactionsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly auditLog: AuditService,
    private readonly accounts: CashAccountsService,
  ) {}

  // ---------------------------------------------------------------- đọc

  private filter(branchId: string, q: ListCashTransactionsQueryDto): SQL | undefined {
    const { start, endExclusive } = dayRange(q.from, q.to);
    return and(
      eq(cashTransactions.branchId, branchId),
      q.direction ? eq(cashTransactions.direction, q.direction) : undefined,
      q.categoryId ? eq(cashTransactions.categoryId, q.categoryId) : undefined,
      q.accountId ? eq(cashTransactions.accountId, q.accountId) : undefined,
      q.partyType ? eq(cashTransactions.partyType, q.partyType) : undefined,
      q.partyId ? eq(cashTransactions.partyId, q.partyId) : undefined,
      q.status ? eq(cashTransactions.status, q.status) : undefined,
      start ? gte(cashTransactions.occurredAt, start) : undefined,
      endExclusive ? lt(cashTransactions.occurredAt, endExclusive) : undefined,
      searchWhere(
        sql`f_search_text(${cashTransactions.code} || ' ' || coalesce(${customers.name}, '') || ' ' || coalesce(${suppliers.name}, '') || ' ' || coalesce(${employee.fullName}, '') || ' ' || coalesce(${cashTransactions.partyName}, '') || ' ' || coalesce(${cashTransactions.note}, ''))`,
        q.q,
      ),
    );
  }

  private headers(db: DbOrTx, where: SQL | undefined) {
    return db
      .select({
        r: cashTransactions,
        catCode: cashCategories.code,
        catName: cashCategories.name,
        accName: cashAccounts.name,
        accType: cashAccounts.type,
        cCode: customers.code,
        cName: customers.name,
        sCode: suppliers.code,
        sName: suppliers.name,
        eCode: employee.code,
        eName: employee.fullName,
        creatorName: creator.fullName,
      })
      .from(cashTransactions)
      .innerJoin(cashCategories, eq(cashCategories.id, cashTransactions.categoryId))
      .innerJoin(cashAccounts, eq(cashAccounts.id, cashTransactions.accountId))
      .leftJoin(
        customers,
        and(
          eq(cashTransactions.partyType, 'customer'),
          eq(customers.id, cashTransactions.partyId),
        ),
      )
      .leftJoin(
        suppliers,
        and(
          eq(cashTransactions.partyType, 'supplier'),
          eq(suppliers.id, cashTransactions.partyId),
        ),
      )
      .leftJoin(
        employee,
        and(
          eq(cashTransactions.partyType, 'employee'),
          eq(employee.id, cashTransactions.partyId),
        ),
      )
      .leftJoin(creator, eq(creator.id, cashTransactions.createdBy))
      .where(where);
  }

  async list(
    branchId: string,
    q: ListCashTransactionsQueryDto,
    mode: 'page' | 'export' = 'page',
  ) {
    const where = this.filter(branchId, q);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(cashTransactions)
      .leftJoin(
        customers,
        and(eq(cashTransactions.partyType, 'customer'), eq(customers.id, cashTransactions.partyId)),
      )
      .leftJoin(
        suppliers,
        and(eq(cashTransactions.partyType, 'supplier'), eq(suppliers.id, cashTransactions.partyId)),
      )
      .leftJoin(
        employee,
        and(eq(cashTransactions.partyType, 'employee'), eq(employee.id, cashTransactions.partyId)),
      )
      .where(where);
    const sort = parseSort(q.sort, CASH_SORT_FIELDS);
    const dir = sort?.desc === false ? asc : desc;
    const sortCol =
      sort?.field === 'code'
        ? cashTransactions.code
        : sort?.field === 'amount'
          ? cashTransactions.amount
          : cashTransactions.occurredAt;
    const { page, limit, offset } =
      mode === 'export'
        ? { page: 1, limit: DOC_EXPORT_MAX_ROWS, offset: 0 }
        : pageParams(q);
    const rows = await this.headers(this.db, where)
      .orderBy(dir(sortCol), desc(cashTransactions.id))
      .limit(limit)
      .offset(offset);
    return {
      summary: await this.summary(branchId, q, where),
      data: rows.map((r) => this.toDto(r)),
      meta: pageMeta(page, limit, total),
    };
  }

  /** Tổng thu/chi theo toàn bộ bộ lọc; tồn đầu/cuối kỳ theo quỹ đang xét và khoảng ngày (bỏ qua lọc loại/đối tượng). */
  private async summary(
    branchId: string,
    q: ListCashTransactionsQueryDto,
    where: SQL | undefined,
  ): Promise<CashSummaryDto> {
    const [tot] = await this.db
      .select({
        totalIn: sql<string>`coalesce(sum(case when ${cashTransactions.direction} = 'in' then ${cashTransactions.amount} else 0 end), 0)`,
        totalOut: sql<string>`coalesce(sum(case when ${cashTransactions.direction} = 'out' then ${cashTransactions.amount} else 0 end), 0)`,
      })
      .from(cashTransactions)
      .leftJoin(
        customers,
        and(eq(cashTransactions.partyType, 'customer'), eq(customers.id, cashTransactions.partyId)),
      )
      .leftJoin(
        suppliers,
        and(eq(cashTransactions.partyType, 'supplier'), eq(suppliers.id, cashTransactions.partyId)),
      )
      .leftJoin(
        employee,
        and(eq(cashTransactions.partyType, 'employee'), eq(employee.id, cashTransactions.partyId)),
      )
      .where(and(where, eq(cashTransactions.status, 'completed')));
    const { start, endExclusive } = dayRange(q.from, q.to);
    const scope = q.accountId
      ? and(eq(cashAccounts.branchId, branchId), eq(cashAccounts.id, q.accountId))
      : eq(cashAccounts.branchId, branchId);
    const [open] = await this.db
      .select({ v: sql<string>`coalesce(sum(${cashAccounts.openingBalance}), 0)` })
      .from(cashAccounts)
      .where(scope);
    const net = async (before: Date | undefined) => {
      const [r] = await this.db
        .select({
          v: sql<string>`coalesce(sum(case when ${cashTransactions.direction} = 'in' then ${cashTransactions.amount} else -${cashTransactions.amount} end), 0)`,
        })
        .from(cashTransactions)
        .innerJoin(cashAccounts, eq(cashAccounts.id, cashTransactions.accountId))
        .where(
          and(
            scope,
            eq(cashTransactions.status, 'completed'),
            before ? lt(cashTransactions.occurredAt, before) : undefined,
          ),
        );
      return dec(r!.v);
    };
    const opening = dec(open!.v).plus(start ? await net(start) : dec(0));
    const closing = dec(open!.v).plus(await net(endExclusive));
    return {
      openingBalance: opening.toFixed(0),
      totalIn: dec(tot!.totalIn).toFixed(0),
      totalOut: dec(tot!.totalOut).toFixed(0),
      closingBalance: closing.toFixed(0),
    };
  }

  async get(branchId: string, id: string): Promise<CashTransactionDto> {
    const [row] = await this.headers(
      this.db,
      and(eq(cashTransactions.id, id), eq(cashTransactions.branchId, branchId)),
    );
    if (!row) throw notFound('phiếu thu/chi');
    const dto = this.toDto(row);
    if (row.catCode === 'customer_payment') {
      dto.allocations = await this.allocationsOf(this.db, id);
    }
    return dto;
  }

  async exportXlsx(branchId: string, q: ListCashTransactionsQueryDto): Promise<Buffer> {
    const { data } = await this.list(branchId, q, 'export');
    const rows: CellValue[][] = data.map((d) => [
      d.code,
      formatVnDateTime(d.occurredAt),
      d.category.name,
      d.party?.name ?? d.partyName,
      d.direction === 'in' ? Number(d.amount) : -Number(d.amount),
      d.account.name,
      d.note,
      STATUS_LABEL[d.status],
    ]);
    return writeSheet(
      'Sổ quỹ',
      ['Mã phiếu', 'Thời gian', 'Loại thu chi', 'Người nộp/nhận', 'Giá trị', 'Quỹ', 'Ghi chú', 'Trạng thái'].map(
        (header) => ({ header, width: 20 }),
      ),
      rows,
    );
  }

  // ---------------------------------------------------------------- tạo

  /** Thu nợ nhanh theo khách: phiếu thu danh mục "Tiền khách trả". */
  async createReceipt(
    user: AuthUser,
    branchId: string,
    customerId: string,
    input: CreateCustomerReceiptDto,
  ): Promise<CashTransactionDto> {
    const [cat] = await this.db
      .select({ id: cashCategories.id })
      .from(cashCategories)
      .where(eq(cashCategories.code, 'customer_payment'));
    if (!cat) throw new AppError(500, 'INTERNAL_ERROR', 'Thiếu danh mục thu "Tiền khách trả"');
    return this.create(user, branchId, {
      direction: 'in',
      amount: input.amount,
      categoryId: cat.id,
      accountId: input.accountId,
      occurredAt: input.occurredAt,
      allocations: input.allocations,
      note: input.note,
      party: { type: 'customer', id: customerId },
    });
  }

  async create(
    user: AuthUser,
    branchId: string,
    input: CreateCashTransactionDto,
  ): Promise<CashTransactionDto> {
    const occurredAt = resolveTime(input.occurredAt, 'occurredAt');
    const { id, warnings } = await this.db.transaction(async (tx) => {
      const [cat] = await tx
        .select()
        .from(cashCategories)
        .where(eq(cashCategories.id, input.categoryId));
      if (!cat || !cat.isActive) {
        throw bad('categoryId', 'Danh mục thu chi không tồn tại hoặc đã ngưng');
      }
      if (cat.direction !== input.direction) {
        throw bad('categoryId', 'Danh mục không cùng hướng thu/chi với phiếu');
      }
      const effect = cat.code ? DEBT_EFFECT[cat.code] : undefined;
      if (effect && input.party?.type !== effect.party) {
        throw bad(
          'party',
          `Danh mục "${cat.name}" cần chọn ${PARTY_LABEL[effect.party]}`,
        );
      }
      const wantsAllocation = cat.code === 'customer_payment';
      if (!wantsAllocation && input.allocations && input.allocations.length > 0) {
        throw bad('allocations', 'Chỉ phiếu thu nợ khách mới cấn trừ vào hóa đơn');
      }
      // Khóa nợ đối tác + chi nhánh ĐẦU TIÊN (phiếu này ghi sổ nợ)
      if (effect) await lockPartyBranch(tx, effect.party, input.party!.id, branchId);
      const party = input.party ? await this.resolveParty(tx, input.party) : null;

      // Khóa mềm dòng quỹ: chặn sửa quỹ đầu kỳ chen giữa lúc tạo phiếu đầu tiên
      const [acc] = await tx
        .select({ id: cashAccounts.id, isActive: cashAccounts.isActive })
        .from(cashAccounts)
        .where(and(eq(cashAccounts.id, input.accountId), eq(cashAccounts.branchId, branchId)))
        .for('share');
      if (!acc) throw bad('accountId', 'Quỹ không tồn tại hoặc thuộc chi nhánh khác');
      if (!acc.isActive) throw bad('accountId', 'Quỹ đã ngưng hoạt động');

      const code = await nextFreeDocumentCode(
        tx,
        input.direction === 'in' ? DOCUMENT_PREFIX.cashIn : DOCUMENT_PREFIX.cashOut,
        async (c) => {
          const [hit] = await tx
            .select({ id: cashTransactions.id })
            .from(cashTransactions)
            .where(sql`lower(${cashTransactions.code}) = lower(${c})`);
          return hit !== undefined;
        },
      );
      const [row] = await tx
        .insert(cashTransactions)
        .values({
          code,
          branchId,
          direction: input.direction,
          amount: input.amount,
          categoryId: cat.id,
          accountId: input.accountId,
          occurredAt,
          partyType: party?.type ?? null,
          partyId: party?.id ?? null,
          partyName: party ? null : input.partyName?.trim() || null,
          vehicleRef: input.vehicleRef?.trim() || null,
          status: 'completed',
          note: input.note?.trim() || null,
          createdBy: user.id,
        })
        .returning();
      if (effect) {
        await tx.insert(debtLedger).values({
          branchId,
          partyType: effect.party,
          partyId: party!.id,
          entryType: 'payment',
          refType: 'cash_transaction',
          refId: row!.id,
          refCode: code,
          amount: dec(input.amount).times(effect.sign).toFixed(0),
          occurredAt,
          createdBy: user.id,
        });
      }
      let allocated = '0';
      if (wantsAllocation) {
        allocated = await this.allocate(tx, branchId, party!.id, row!.id, input);
      }
      const warnings: CashWarningDto[] = [];
      if (input.direction === 'out') {
        const balance = await this.accounts.balanceOf(tx, input.accountId);
        if (dec(balance).isNegative()) {
          warnings.push({
            code: 'CASH_NEGATIVE',
            message: `Quỹ sẽ âm ${dec(balance).abs().toFixed(0)} ₫ sau phiếu chi này`,
          });
        }
      }
      await this.auditLog.record(tx, {
        action: 'cash_transaction.create',
        entityType: 'cash_transaction',
        entityId: row!.id,
        after: {
          code,
          direction: input.direction,
          amount: input.amount,
          category: cat.code ?? cat.name,
          accountId: input.accountId,
          party: party ? { type: party.type, id: party.id } : null,
          allocated,
        },
      });
      return { id: row!.id, warnings };
    });
    const dto = await this.get(branchId, id);
    dto.warnings = warnings;
    return dto;
  }

  /**
   * Cấn trừ phiếu thu vào hóa đơn của khách tại chi nhánh. `allocations` bỏ trống = tự cấn vào hóa đơn còn nợ cũ nhất;
   * `[]` = không cấn; có danh sách = cấn đúng theo đó. Trả tổng đã cấn.
   */
  private async allocate(
    tx: DbOrTx,
    branchId: string,
    customerId: string,
    cashId: string,
    input: { amount: string; allocations?: Array<{ invoiceId: string; amount: string }> },
  ): Promise<string> {
    const pay = dec(input.amount);
    let plan: Array<{ invoiceId: string; amount: string }>;
    if (input.allocations === undefined) {
      // Khóa các hóa đơn còn hiệu lực của khách theo id rồi mới tính còn nợ (hai lệnh riêng: snapshot mới sau khóa)
      await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.customerId, customerId),
            eq(invoices.branchId, branchId),
            eq(invoices.status, 'completed'),
          ),
        )
        .orderBy(asc(invoices.id))
        .for('update');
      const open = await tx
        .select({ id: invoices.id, left: outstandingExpr })
        .from(invoices)
        .where(
          and(
            eq(invoices.customerId, customerId),
            eq(invoices.branchId, branchId),
            eq(invoices.status, 'completed'),
            sql`${outstandingExpr} > 0`,
          ),
        )
        .orderBy(asc(invoices.invoicedAt), asc(invoices.code));
      plan = [];
      let remain = pay;
      for (const inv of open) {
        if (remain.lte(0)) break;
        const take = dec(inv.left).lt(remain) ? dec(inv.left) : remain;
        plan.push({ invoiceId: inv.id, amount: take.toFixed(0) });
        remain = remain.minus(take);
      }
    } else {
      plan = input.allocations;
      const ids = plan.map((a) => a.invoiceId);
      if (new Set(ids).size !== ids.length) {
        throw bad('allocations', 'Một hóa đơn chỉ xuất hiện một lần trong danh sách cấn trừ');
      }
      const sum = plan.reduce((s, a) => s.plus(dec(a.amount)), dec(0));
      if (sum.gt(pay)) {
        throw new AppError(
          422,
          'ALLOCATION_EXCEEDS',
          'Tổng cấn trừ vượt số tiền thu',
          [{ field: 'allocations', message: `Tổng cấn trừ ${sum.toFixed(0)} vượt số tiền thu ${pay.toFixed(0)}` }],
        );
      }
      if (ids.length > 0) {
        await tx
          .select({ id: invoices.id })
          .from(invoices)
          .where(inArray(invoices.id, ids))
          .orderBy(asc(invoices.id))
          .for('update');
        const rows = await tx
          .select({
            id: invoices.id,
            customerId: invoices.customerId,
            branchId: invoices.branchId,
            status: invoices.status,
            left: outstandingExpr,
          })
          .from(invoices)
          .where(inArray(invoices.id, ids));
        const by = new Map(rows.map((r) => [r.id, r]));
        const details: Array<{ field: string; message: string }> = [];
        plan.forEach((a, i) => {
          const inv = by.get(a.invoiceId);
          if (
            !inv ||
            inv.customerId !== customerId ||
            inv.branchId !== branchId ||
            inv.status !== 'completed'
          ) {
            details.push({
              field: `allocations.${i}.invoiceId`,
              message: 'Hóa đơn không tồn tại, đã hủy hoặc không thuộc khách / chi nhánh này',
            });
          } else if (dec(a.amount).gt(dec(inv.left))) {
            details.push({
              field: `allocations.${i}.amount`,
              message: `Chỉ còn nợ ${dec(inv.left).toFixed(0)}`,
            });
          }
        });
        if (details.length > 0) {
          throw new AppError(422, 'ALLOCATION_EXCEEDS', 'Cấn trừ vượt số còn nợ của hóa đơn', details);
        }
      }
    }
    for (const a of plan) {
      await tx.insert(paymentAllocations).values({
        cashTransactionId: cashId,
        invoiceId: a.invoiceId,
        amount: a.amount,
      });
    }
    return plan.reduce((s, a) => s.plus(dec(a.amount)), dec(0)).toFixed(0);
  }

  // ---------------------------------------------------------------- sửa ghi chú, hủy

  async updateNote(
    branchId: string,
    id: string,
    note: string | null,
  ): Promise<CashTransactionDto> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(cashTransactions)
        .where(and(eq(cashTransactions.id, id), eq(cashTransactions.branchId, branchId)))
        .for('update');
      if (!row) throw notFound('phiếu thu/chi');
      if (row.status === 'cancelled') {
        throw new AppError(422, 'INVALID_STATE', 'Phiếu đã hủy, không sửa được');
      }
      await tx
        .update(cashTransactions)
        .set({ note: note?.trim() || null, updatedAt: new Date() })
        .where(eq(cashTransactions.id, id));
      await this.auditLog.record(tx, {
        action: 'cash_transaction.update_note',
        entityType: 'cash_transaction',
        entityId: id,
        before: { note: row.note },
        after: { note: note?.trim() || null },
      });
    });
    return this.get(branchId, id);
  }

  /** Hủy phiếu: đổi trạng thái, đảo bút toán công nợ (nếu có). Phiếu thu lúc xuất hóa đơn chỉ hủy qua hóa đơn gốc. */
  async cancel(
    branchId: string,
    id: string,
    reason: string,
  ): Promise<CashTransactionDto> {
    if (!reason.trim()) throw bad('reason', 'Phải nhập lý do hủy');
    await this.db.transaction(async (tx) => {
      const [peek] = await tx
        .select({ partyType: cashTransactions.partyType, partyId: cashTransactions.partyId })
        .from(cashTransactions)
        .where(and(eq(cashTransactions.id, id), eq(cashTransactions.branchId, branchId)));
      if (!peek) throw notFound('phiếu thu/chi');
      // Khóa nợ đối tác trước (nếu phiếu có thể đã ghi sổ nợ), rồi khóa phiếu
      if (peek.partyId && (peek.partyType === 'customer' || peek.partyType === 'supplier')) {
        await lockPartyBranch(tx, peek.partyType, peek.partyId, branchId);
      }
      const [row] = await tx
        .select()
        .from(cashTransactions)
        .where(eq(cashTransactions.id, id))
        .for('update');
      if (!row || row.branchId !== branchId) throw notFound('phiếu thu/chi');
      if (row.status === 'cancelled') {
        throw new AppError(422, 'INVALID_STATE', 'Phiếu đã hủy rồi');
      }
      if (row.refType === 'invoice') {
        throw new AppError(
          409,
          'INVALID_STATE',
          'Phiếu thu này là tiền thanh toán lúc xuất hóa đơn, hãy hủy hóa đơn gốc',
        );
      }
      const now = new Date();
      const [booked] = await tx
        .select({ v: sql<string>`coalesce(sum(${debtLedger.amount}), 0)` })
        .from(debtLedger)
        .where(
          and(
            eq(debtLedger.refType, 'cash_transaction'),
            eq(debtLedger.refId, id),
          ),
        );
      if (!dec(booked!.v).isZero() && row.partyId && row.partyType) {
        await tx.insert(debtLedger).values({
          branchId,
          partyType: row.partyType,
          partyId: row.partyId,
          entryType: 'adjustment',
          refType: 'cash_transaction',
          refId: id,
          refCode: row.code,
          amount: dec(booked!.v).negated().toFixed(0),
          occurredAt: now,
          note: `Hủy phiếu ${row.code}`,
        });
      }
      await tx
        .update(cashTransactions)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancelReason: reason.trim(),
          updatedAt: now,
        })
        .where(eq(cashTransactions.id, id));
      await this.auditLog.record(tx, {
        action: 'cash_transaction.cancel',
        entityType: 'cash_transaction',
        entityId: id,
        before: { status: 'completed', amount: row.amount },
        after: { status: 'cancelled', reason: reason.trim() },
      });
    });
    return this.get(branchId, id);
  }

  // ---------------------------------------------------------------- nội bộ

  private async resolveParty(
    db: DbOrTx,
    p: { type: CashPartyType; id: string },
  ): Promise<Party> {
    if (p.type === 'customer') {
      const [c] = await db
        .select({ id: customers.id, code: customers.code, name: customers.name })
        .from(customers)
        .where(
          and(eq(customers.id, p.id), isNull(customers.deletedAt), isNull(customers.linkedBranchId)),
        );
      if (!c) throw notFound('khách hàng');
      return { type: 'customer', ...c };
    }
    if (p.type === 'supplier') {
      const [s] = await db
        .select({ id: suppliers.id, code: suppliers.code, name: suppliers.name })
        .from(suppliers)
        .where(
          and(eq(suppliers.id, p.id), isNull(suppliers.deletedAt), isNull(suppliers.linkedBranchId)),
        );
      if (!s) throw notFound('nhà cung cấp');
      return { type: 'supplier', ...s };
    }
    const [u] = await db
      .select({ id: users.id, code: users.code, name: users.fullName })
      .from(users)
      .where(eq(users.id, p.id));
    if (!u) throw notFound('nhân viên');
    return { type: 'employee', ...u };
  }

  private async allocationsOf(db: DbOrTx, id: string): Promise<CashAllocationDto[]> {
    const rows = await db
      .select({
        invoiceId: invoices.id,
        invoiceCode: invoices.code,
        amount: paymentAllocations.amount,
      })
      .from(paymentAllocations)
      .innerJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId))
      .where(eq(paymentAllocations.cashTransactionId, id))
      .orderBy(asc(invoices.invoicedAt), asc(invoices.code));
    return rows.map((r) => ({
      invoiceId: r.invoiceId,
      invoiceCode: r.invoiceCode,
      amount: dec(r.amount).toFixed(0),
    }));
  }

  private toDto(row: {
    r: TxRow;
    catCode: string | null;
    catName: string;
    accName: string;
    accType: 'cash' | 'bank';
    cCode: string | null;
    cName: string | null;
    sCode: string | null;
    sName: string | null;
    eCode: string | null;
    eName: string | null;
    creatorName: string | null;
  }): CashTransactionDto {
    const r = row.r;
    let party: CashTransactionDto['party'] = null;
    if (r.partyType === 'customer' && r.partyId && row.cName) {
      party = { type: 'customer', id: r.partyId, code: row.cCode, name: row.cName };
    } else if (r.partyType === 'supplier' && r.partyId && row.sName) {
      party = { type: 'supplier', id: r.partyId, code: row.sCode, name: row.sName };
    } else if (r.partyType === 'employee' && r.partyId && row.eName) {
      party = { type: 'employee', id: r.partyId, code: row.eCode, name: row.eName };
    }
    return {
      id: r.id,
      code: r.code,
      branchId: r.branchId,
      direction: r.direction,
      amount: dec(r.amount).toFixed(0),
      category: { id: r.categoryId, code: row.catCode, name: row.catName },
      account: { id: r.accountId, name: row.accName, type: row.accType },
      party,
      partyName: r.partyName,
      vehicleRef: r.vehicleRef,
      occurredAt: r.occurredAt.toISOString(),
      refType: r.refType,
      note: r.note,
      status: r.status,
      createdBy:
        r.createdBy && row.creatorName
          ? { id: r.createdBy, fullName: row.creatorName }
          : null,
      createdAt: r.createdAt.toISOString(),
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
      cancelReason: r.cancelReason,
    };
  }
}

function bad(field: string, message: string): AppError {
  return new AppError(400, 'VALIDATION_ERROR', message, [{ field, message }]);
}
