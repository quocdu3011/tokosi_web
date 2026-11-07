import { Inject, Injectable } from '@nestjs/common';
import {
  CUSTOMER_PRICE_LEVELS,
  CUSTOMER_SALES_METHODS,
  DOCUMENT_PREFIX,
  normalizeVnPhone,
  type PermissionScope,
} from '@kiot/shared';
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
  lte,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AppError } from '../../common/app-error.js';
import type { AuthUser } from '../../common/auth-user.js';
import { dec } from '../../common/costing.js';
import {
  writeSheet,
  type CellValue,
  type SheetColumn,
} from '../../common/excel.js';
import { pageMeta, pageParams, parseSort } from '../../common/pagination.js';
import { uniqueViolation } from '../../common/pg-errors.js';
import { vnDayStart } from '../../common/vn-date.js';
import { nextFreeDocumentCode } from '../../db/code-sequence.js';
import { DB, type Database, type DbOrTx } from '../../db/database.module.js';
import { partySearchExpr } from '../../db/schema/_search.js';
import {
  branches,
  customerBranchTerms,
  customerProfiles,
  customerVisits,
  customers,
  debtLedger,
  invoices,
  salesReturns,
  users,
} from '../../db/schema/index.js';
import { searchWhere } from '../../db/search.js';
import { AuditService } from '../audit/audit.service.js';
import { PermissionsService } from '../authorization/permissions.service.js';
import { BranchAccessService } from '../branches/branch-access.service.js';
import { dayRange } from '../purchasing/purchase-lines.js';
import type {
  LedgerDto,
  LedgerQueryDto,
} from '../suppliers/suppliers.dto.js';
import { buildAging, buildStatementLines } from './customer-statement.js';
import type {
  CustomerAgingDto,
  CustomerStatementDto,
} from './customers-statement.dto.js';
import {
  CUSTOMER_SORT_FIELDS,
  type CreateCustomerDto,
  type CreateCustomerVisitDto,
  type CustomerBranchFiguresDto,
  type CustomerDto,
  type CustomerLookupItemDto,
  type CustomerProfileDto,
  type CustomerProfileInputDto,
  type CustomerTermsDto,
  type CustomerVisitDto,
  type CustomerWarningDto,
  type ListCustomersQueryDto,
  type LookupCustomersQueryDto,
  type SetCustomerTermsDto,
  type UpdateCustomerDto,
} from './customers.dto.js';

export const CUSTOMER_EXPORT_MAX_ROWS = 10_000;
export const CUSTOMER_LOOKUP_LIMIT = 20;

type CustomerRow = typeof customers.$inferSelect;
type ProfileRow = typeof customerProfiles.$inferSelect;
interface Branch {
  id: string;
  code: string;
  name: string;
}
interface Row {
  c: CustomerRow;
  ownerName: string | null;
  createdByName: string | null;
}

const owner = alias(users, 'sales_owner');

/**
 * Khách hàng. Dùng chung giữa các chi nhánh, nhưng mọi số tiền (công nợ, hạn mức, tổng bán) là RIÊNG TỪNG CHI NHÁNH,
 * không bao giờ cộng gộp. Công nợ = tổng `debt_ledger`, không lưu ở bảng khách. Khách hệ thống đại diện chi nhánh
 * (`linked_branch_id`, dùng cho chuyển kho) bị ẩn và không sửa được.
 *
 * Phân quyền: `customer.view` xem MỌI khách (không có phạm vi riêng); `customer.edit` "chỉ của mình" = chỉ sửa khách
 * mình phụ trách; `debt.view` "chỉ của mình" = chỉ thấy tiền của khách mình phụ trách.
 */
@Injectable()
export class CustomersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly auditLog: AuditService,
    private readonly permissions: PermissionsService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  // ------------------------------------------------------------------ đọc

  async list(
    user: AuthUser,
    branchId: string,
    q: ListCustomersQueryDto,
    mode: 'page' | 'export' = 'page',
  ) {
    const debtScope = await this.debtScope(user);
    if (q.hasDebt !== undefined && !debtScope) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Bạn không có quyền xem công nợ nên không lọc theo nợ được',
        { permission: 'debt.view' },
      );
    }
    const branch = await this.workingBranch(user, branchId);

    const conditions: Array<SQL | undefined> = [
      isNull(customers.deletedAt),
      q.includeInternal ? undefined : isNull(customers.linkedBranchId),
      searchWhere(partySearchExpr(customers), q.q),
      q.priceLevel ? eq(customers.priceLevel, q.priceLevel) : undefined,
      q.salesOwnerId ? eq(customers.salesOwnerId, q.salesOwnerId) : undefined,
      q.acquisitionSource?.trim()
        ? sql`f_search_text(coalesce(${customers.acquisitionSource}, '')) = f_search_text(${q.acquisitionSource.trim()})`
        : undefined,
      q.newSinceFrom
        ? gte(customers.newSince, `${q.newSinceFrom}-01`)
        : undefined,
      q.newSinceTo ? lte(customers.newSince, `${q.newSinceTo}-01`) : undefined,
      q.isActive === undefined
        ? undefined
        : eq(customers.isActive, q.isActive),
      q.hasDebt === undefined ? undefined : debtCondition(branchId, q.hasDebt),
      // debt.view "chỉ của mình": lọc theo nợ chỉ trong khách mình phụ trách (tránh suy ra nợ của khách người khác)
      q.hasDebt !== undefined && debtScope === 'own'
        ? eq(customers.salesOwnerId, user.id)
        : undefined,
    ];
    const where = and(...conditions);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(customers)
      .where(where);

    const sort = parseSort(q.sort, CUSTOMER_SORT_FIELDS);
    const direction = sort?.desc ? desc : asc;
    const sortColumn =
      sort?.field === 'name'
        ? customers.name
        : sort?.field === 'createdAt'
          ? customers.createdAt
          : sort?.field === 'newSince'
            ? customers.newSince
            : customers.code;
    const { page, limit, offset } =
      mode === 'export'
        ? { page: 1, limit: CUSTOMER_EXPORT_MAX_ROWS, offset: 0 }
        : pageParams(q);

    const rows = await this.rowsQuery(this.db)
      .where(where)
      .orderBy(direction(sortColumn), asc(customers.id))
      .limit(limit)
      .offset(offset);

    const dtos = await this.toDtos(this.db, rows, [branch], user, debtScope);
    return { data: dtos, meta: pageMeta(page, limit, total) };
  }

  /** Xuất Excel theo đúng bộ lọc, tiêu đề như file TKS để nhập lại được. Không có cột công nợ (nợ đầu kỳ chỉ nhập khi tạo khách). */
  async exportXlsx(
    user: AuthUser,
    branchId: string,
    q: ListCustomersQueryDto,
  ): Promise<Buffer> {
    const { data } = await this.list(user, branchId, q, 'export');
    const visits = new Map<string, string[]>();
    const ids = data.map((d) => d.id);
    for (let i = 0; i < ids.length; i += 1000) {
      const part = await this.db
        .select({
          customerId: customerVisits.customerId,
          visitedOn: customerVisits.visitedOn,
        })
        .from(customerVisits)
        .where(inArray(customerVisits.customerId, ids.slice(i, i + 1000)))
        .orderBy(asc(customerVisits.visitedOn));
      for (const v of part) {
        const list = visits.get(v.customerId) ?? [];
        list.push(v.visitedOn);
        visits.set(v.customerId, list);
      }
    }
    const columns: SheetColumn[] = [
      { header: 'Mã Khách hàng', width: 14 },
      { header: 'Tên khách', width: 38 },
      { header: 'Sale', width: 22 },
      { header: 'Level giá', width: 10 },
      { header: 'Khách mới', width: 14 },
      { header: 'Tiếp khách lần cuối', width: 18 },
      { header: 'Điện thoại', width: 14 },
      { header: 'Địa chỉ', width: 40 },
      { header: 'Định vị kho', width: 26 },
      { header: 'Số lượng kho', width: 12 },
      { header: 'Diện tích', width: 14 },
      { header: 'Đối thủ', width: 22 },
      { header: 'Hình thức bán hàng', width: 26 },
      { header: 'Quy mô khách', width: 14 },
      { header: 'Các ngày tiếp khách', width: 30 },
      { header: 'Ảnh kho', width: 30 },
      { header: 'Trạng thái', width: 12 },
      { header: 'Ghi chú', width: 30 },
    ];
    const rows = data.map((c): CellValue[] => {
      const days = visits.get(c.id) ?? [];
      return [
        c.code,
        c.name,
        c.salesOwner?.fullName ?? null,
        CUSTOMER_PRICE_LEVELS[c.priceLevel],
        formatNewCustomer(c.newSince, c.acquisitionSource),
        days.length > 0 ? isoToVn(days[days.length - 1]!) : null,
        c.phone,
        c.address,
        c.profile?.warehouseLocation ?? null,
        c.profile?.warehouseCount ?? null,
        c.profile?.warehouseArea ?? null,
        c.profile?.competitors ?? null,
        c.profile && c.profile.salesMethods.length > 0
          ? c.profile.salesMethods.join(', ')
          : null,
        c.profile?.scale ?? 'Chưa có',
        days.length > 0 ? days.map(isoToVn).join(', ') : null,
        c.profile?.warehousePhotoUrl ?? null,
        c.isActive ? 1 : 0,
        c.note,
      ];
    });
    return writeSheet('Theo khách hàng', columns, rows);
  }

  async get(
    user: AuthUser,
    _workingBranchId: string,
    id: string,
  ): Promise<CustomerDto> {
    const debtScope = await this.debtScope(user);
    const allowed = await this.branchAccess.listAllowed(user);
    const rows = await this.rowsQuery(this.db).where(this.byIds([id]));
    if (rows.length === 0) throw notFound();
    const [dto] = await this.toDtos(this.db, rows, allowed, user, debtScope);
    const warnings = await this.phoneWarnings(this.db, rows[0]!.c);
    if (warnings.length > 0) dto!.warnings = warnings;
    return dto!;
  }

  /** Tìm nhanh cho ô chọn khách (tối đa 20, chỉ khách đang hoạt động); kèm công nợ/hạn mức tại chi nhánh làm việc. */
  async lookup(
    user: AuthUser,
    branchId: string,
    q: LookupCustomersQueryDto,
  ): Promise<CustomerLookupItemDto[]> {
    const debtScope = await this.debtScope(user);
    const branch = await this.workingBranch(user, branchId);
    const rows = await this.rowsQuery(this.db)
      .where(
        and(
          this.byIds(undefined),
          eq(customers.isActive, true),
          searchWhere(partySearchExpr(customers), q.q),
        ),
      )
      .orderBy(asc(customers.name), asc(customers.id))
      .limit(CUSTOMER_LOOKUP_LIMIT);
    const dtos = await this.toDtos(this.db, rows, [branch], user, debtScope);
    return dtos.map((d): CustomerLookupItemDto => {
      const f = d.branches[0]!;
      const item: CustomerLookupItemDto = {
        id: d.id,
        code: d.code,
        name: d.name,
        phone: d.phone,
        address: d.address,
        priceLevel: d.priceLevel,
        salesOwner: d.salesOwner,
      };
      if (f.balance !== undefined) {
        item.balance = f.balance;
        item.creditLimit = f.creditLimit ?? null;
        item.creditAvailable =
          f.creditLimit == null
            ? null
            : dec(f.creditLimit).minus(dec(f.balance)).toFixed(0);
      }
      return item;
    });
  }

  /**
   * Sổ công nợ của khách TẠI chi nhánh làm việc: số dư đầu kỳ (trước `from`), các dòng sổ cái trong khoảng ngày kèm
   * số dư cộng dồn, số dư cuối kỳ. Chỉ đọc `debt_ledger` (nguồn duy nhất của nợ).
   */
  async ledger(
    user: AuthUser,
    branchId: string,
    id: string,
    q: LedgerQueryDto,
  ): Promise<LedgerDto> {
    const [row] = await this.rowsQuery(this.db).where(this.byIds([id]));
    if (!row) throw notFound();
    await this.assertDebtVisible(user, row.c);
    const from = q.from ? vnDayStart(q.from, 'from') : undefined;
    const toExclusive = q.to
      ? new Date(vnDayStart(q.to, 'to').getTime() + 24 * 3600 * 1000)
      : undefined;
    if (from && toExclusive && from >= toExclusive) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Khoảng ngày không hợp lệ', [
        {
          field: 'to',
          message: 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu',
        },
      ]);
    }
    const base = and(
      eq(debtLedger.partyType, 'customer'),
      eq(debtLedger.partyId, id),
      eq(debtLedger.branchId, branchId),
    );
    let opening = dec(0);
    if (from) {
      const [sum] = await this.db
        .select({
          amount: sql<string>`coalesce(sum(${debtLedger.amount}), 0)`,
        })
        .from(debtLedger)
        .where(and(base, lt(debtLedger.occurredAt, from)));
      opening = dec(sum!.amount);
    }
    const entries = await this.db
      .select()
      .from(debtLedger)
      .where(
        and(
          base,
          from ? gte(debtLedger.occurredAt, from) : undefined,
          toExclusive ? lt(debtLedger.occurredAt, toExclusive) : undefined,
        ),
      )
      .orderBy(
        asc(debtLedger.occurredAt),
        asc(debtLedger.createdAt),
        asc(debtLedger.id),
      );
    let balance = opening;
    const lines = entries.map((e) => {
      balance = balance.plus(dec(e.amount));
      return {
        occurredAt: e.occurredAt.toISOString(),
        entryType: e.entryType,
        refType: e.refType,
        refId: e.refId,
        refCode: e.refCode,
        amount: dec(e.amount).toFixed(0),
        balance: balance.toFixed(0),
        note: e.note,
      };
    });
    return {
      branchId,
      openingBalance: opening.toFixed(0),
      entries: lines,
      closingBalance: balance.toFixed(0),
    };
  }

  /**
   * Tuổi nợ của khách tại chi nhánh làm việc: các hóa đơn còn nợ (tính theo ngày hóa đơn, kèm hạn đến hạn nếu khách có
   * kỳ hạn công nợ), tổng theo nhóm 0–30 / 31–60 / 61–90 / >90 ngày và phần nợ không gắn hóa đơn.
   */
  async aging(
    user: AuthUser,
    branchId: string,
    id: string,
  ): Promise<CustomerAgingDto> {
    const [row] = await this.rowsQuery(this.db).where(this.byIds([id]));
    if (!row) throw notFound();
    await this.assertDebtVisible(user, row.c);
    return buildAging(this.db, id, branchId);
  }

  /** Biên bản đối chiếu công nợ theo kỳ tại chi nhánh làm việc (dựng từ sổ công nợ). */
  async statement(
    user: AuthUser,
    branchId: string,
    id: string,
    q: LedgerQueryDto,
  ): Promise<CustomerStatementDto> {
    const [row] = await this.rowsQuery(this.db).where(this.byIds([id]));
    if (!row) throw notFound();
    await this.assertDebtVisible(user, row.c);
    const range = dayRange(q.from, q.to);
    const [branch] = await this.db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(eq(branches.id, branchId));
    const body = await buildStatementLines(this.db, id, branchId, range);
    return {
      customer: {
        id: row.c.id,
        code: row.c.code,
        name: row.c.name,
        phone: row.c.phone,
        address: row.c.address,
      },
      branch: { id: branchId, name: branch?.name ?? '' },
      from: q.from ?? null,
      to: q.to ?? null,
      ...body,
    };
  }

  // ------------------------------------------------------------------ ghi

  async create(
    user: AuthUser,
    branchId: string,
    input: CreateCustomerDto,
  ): Promise<CustomerDto> {
    const editScope = await this.editScope(user);
    let salesOwnerId = input.salesOwnerId ?? null;
    if (editScope === 'own') {
      // "Chỉ của mình": khách mới tạo luôn do chính mình phụ trách
      if (salesOwnerId !== null && salesOwnerId !== user.id) {
        throw new AppError(
          403,
          'FORBIDDEN',
          'Bạn chỉ được tạo khách do chính mình phụ trách',
          { permission: 'customer.edit' },
        );
      }
      salesOwnerId = user.id;
    }
    const phone = cleanPhone(input.phone);
    const id = await this.db
      .transaction(async (tx) => {
        if (salesOwnerId) await this.assertSalesOwner(tx, salesOwnerId);
        if (input.code) await this.assertCodeFree(tx, input.code);
        const [row] = await tx
          .insert(customers)
          .values({
            code:
              input.code ??
              (await nextFreeDocumentCode(tx, DOCUMENT_PREFIX.customer, (c) =>
                this.codeTaken(tx, c),
              )),
            name: input.name.trim(),
            phone,
            address: cleanText(input.address),
            salesOwnerId,
            priceLevel: input.priceLevel ?? 'new',
            newSince: input.newSince ?? null,
            acquisitionSource: cleanText(input.acquisitionSource),
            note: cleanText(input.note),
            createdBy: user.id,
          })
          .returning();
        const profile = await applyProfile(tx, row!.id, input.profile);
        await this.auditLog.record(tx, {
          action: 'customer.create',
          entityType: 'customer',
          entityId: row!.id,
          after: { ...auditView(row!), profile },
        });
        return row!.id;
      })
      .catch(rethrowDuplicateCode);
    return this.get(user, branchId, id);
  }

  async update(
    user: AuthUser,
    branchId: string,
    id: string,
    input: UpdateCustomerDto,
  ): Promise<CustomerDto> {
    const editScope = await this.editScope(user);
    await this.db.transaction(async (tx) => {
      const before = await this.lockEditable(tx, id);
      assertCanEdit(user, editScope, before);
      if (editScope === 'own' && input.salesOwnerId !== undefined) {
        if (input.salesOwnerId !== user.id) {
          throw new AppError(
            403,
            'FORBIDDEN',
            'Bạn không được chuyển khách cho nhân viên khác phụ trách',
            { permission: 'customer.edit' },
          );
        }
      }
      if (input.salesOwnerId) await this.assertSalesOwner(tx, input.salesOwnerId);
      const patch: Partial<typeof customers.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.phone !== undefined) patch.phone = cleanPhone(input.phone);
      if (input.address !== undefined) patch.address = cleanText(input.address);
      if (input.salesOwnerId !== undefined)
        patch.salesOwnerId = input.salesOwnerId;
      if (input.priceLevel !== undefined) patch.priceLevel = input.priceLevel;
      if (input.newSince !== undefined) patch.newSince = input.newSince;
      if (input.acquisitionSource !== undefined)
        patch.acquisitionSource = cleanText(input.acquisitionSource);
      if (input.note !== undefined) patch.note = cleanText(input.note);
      if (input.isActive !== undefined) patch.isActive = input.isActive;
      const [after] = await tx
        .update(customers)
        .set(patch)
        .where(eq(customers.id, id))
        .returning();
      const profile = await applyProfile(tx, id, input.profile);
      await this.auditLog.record(tx, {
        action: 'customer.update',
        entityType: 'customer',
        entityId: id,
        before: auditView(before),
        after: {
          ...auditView(after!),
          ...(input.profile !== undefined ? { profile } : {}),
        },
      });
    });
    return this.get(user, branchId, id);
  }

  /** Đặt (hoặc xóa) hạn mức và kỳ hạn công nợ của khách TẠI một chi nhánh. Cả hai null = không giới hạn (xóa dòng). */
  async setTerms(
    user: AuthUser,
    id: string,
    branchId: string,
    input: SetCustomerTermsDto,
  ): Promise<CustomerTermsDto> {
    await this.branchAccess.assertAccess(user, branchId);
    const editScope = await this.editScope(user);
    const creditLimit = input.creditLimit ?? null;
    const paymentTermDays = input.paymentTermDays ?? null;
    await this.db.transaction(async (tx) => {
      const row = await this.lockEditable(tx, id);
      assertCanEdit(user, editScope, row);
      await this.assertDebtVisible(user, row);
      const [before] = await tx
        .select()
        .from(customerBranchTerms)
        .where(
          and(
            eq(customerBranchTerms.customerId, id),
            eq(customerBranchTerms.branchId, branchId),
          ),
        );
      if (creditLimit === null && paymentTermDays === null) {
        await tx
          .delete(customerBranchTerms)
          .where(
            and(
              eq(customerBranchTerms.customerId, id),
              eq(customerBranchTerms.branchId, branchId),
            ),
          );
      } else {
        await tx
          .insert(customerBranchTerms)
          .values({ customerId: id, branchId, creditLimit, paymentTermDays })
          .onConflictDoUpdate({
            target: [customerBranchTerms.customerId, customerBranchTerms.branchId],
            set: { creditLimit, paymentTermDays, updatedAt: new Date() },
          });
      }
      await this.auditLog.record(tx, {
        action: 'customer.terms',
        entityType: 'customer',
        entityId: id,
        branchId,
        before: before
          ? {
              creditLimit: before.creditLimit,
              paymentTermDays: before.paymentTermDays,
            }
          : null,
        after: { creditLimit, paymentTermDays },
      });
    });
    return { branchId, creditLimit, paymentTermDays };
  }

  // ------------------------------------------------------------ tiếp khách

  async listVisits(id: string): Promise<CustomerVisitDto[]> {
    await this.mustExist(this.db, id);
    const rows = await this.db
      .select({ v: customerVisits, createdByName: users.fullName })
      .from(customerVisits)
      .leftJoin(users, eq(users.id, customerVisits.createdBy))
      .where(eq(customerVisits.customerId, id))
      .orderBy(desc(customerVisits.visitedOn), desc(customerVisits.createdAt));
    return rows.map(({ v, createdByName }) => ({
      id: v.id,
      visitedOn: v.visitedOn,
      note: v.note,
      createdByName,
      createdAt: v.createdAt.toISOString(),
    }));
  }

  async addVisit(
    user: AuthUser,
    id: string,
    input: CreateCustomerVisitDto,
  ): Promise<CustomerVisitDto> {
    if (!isRealDate(input.visitedOn)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Ngày không hợp lệ', [
        { field: 'visitedOn', message: 'Ngày không tồn tại' },
      ]);
    }
    if (input.visitedOn > todayVn()) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Ngày tiếp khách ở tương lai', [
        { field: 'visitedOn', message: 'Không được chọn ngày trong tương lai' },
      ]);
    }
    return this.db
      .transaction(async (tx) => {
        await this.mustExist(tx, id);
        const [v] = await tx
          .insert(customerVisits)
          .values({
            customerId: id,
            visitedOn: input.visitedOn,
            note: cleanText(input.note),
            createdBy: user.id,
          })
          .returning();
        await this.auditLog.record(tx, {
          action: 'customer.visit.add',
          entityType: 'customer',
          entityId: id,
          after: { visitedOn: v!.visitedOn, note: v!.note },
        });
        return {
          id: v!.id,
          visitedOn: v!.visitedOn,
          note: v!.note,
          createdByName: null,
          createdAt: v!.createdAt.toISOString(),
        } satisfies CustomerVisitDto;
      })
      .catch((e: unknown) => {
        if (uniqueViolation(e)) {
          throw new AppError(
            409,
            'DUPLICATE_VISIT',
            'Khách này đã có ngày tiếp khách trùng ngày đó',
            [{ field: 'visitedOn', message: 'Ngày đã được ghi' }],
          );
        }
        throw e;
      });
  }

  async removeVisit(id: string, visitId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.mustExist(tx, id);
      const [v] = await tx
        .delete(customerVisits)
        .where(
          and(
            eq(customerVisits.id, visitId),
            eq(customerVisits.customerId, id),
          ),
        )
        .returning();
      if (!v) {
        throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy ngày tiếp khách');
      }
      await this.auditLog.record(tx, {
        action: 'customer.visit.remove',
        entityType: 'customer',
        entityId: id,
        before: { visitedOn: v.visitedOn, note: v.note },
      });
    });
  }

  // ------------------------------------------------------------------ nội bộ

  private async debtScope(user: AuthUser): Promise<PermissionScope | null> {
    const g = await this.permissions.getGrant(user.role, 'debt.view');
    return g ? g.scope : null;
  }

  private async editScope(user: AuthUser): Promise<PermissionScope> {
    const g = await this.permissions.getGrant(user.role, 'customer.edit');
    if (!g) {
      throw new AppError(403, 'FORBIDDEN', 'Bạn không có quyền sửa khách hàng', {
        permission: 'customer.edit',
      });
    }
    return g.scope;
  }

  /** Báo 403 nếu quyền công nợ chỉ "của mình" mà đây không phải khách mình phụ trách (hoặc không có quyền). */
  private async assertDebtVisible(
    user: AuthUser,
    c: { salesOwnerId: string | null },
  ): Promise<void> {
    const scope = await this.debtScope(user);
    if (!seesMoney(scope, user, c)) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Bạn không có quyền xem công nợ của khách này',
        { permission: 'debt.view' },
      );
    }
  }

  private async workingBranch(
    user: AuthUser,
    branchId: string,
  ): Promise<Branch> {
    const allowed = await this.branchAccess.listAllowed(user);
    const b = allowed.find((x) => x.id === branchId);
    if (!b) {
      throw new AppError(
        403,
        'BRANCH_FORBIDDEN',
        'Bạn không được phép làm việc với chi nhánh này',
        { branchId },
      );
    }
    return b;
  }

  private rowsQuery(db: DbOrTx) {
    return db
      .select({
        c: customers,
        ownerName: owner.fullName,
        createdByName: users.fullName,
      })
      .from(customers)
      .leftJoin(owner, eq(owner.id, customers.salesOwnerId))
      .leftJoin(users, eq(users.id, customers.createdBy));
  }

  /** Điều kiện "khách thật, chưa xóa" (loại khách chi nhánh); có `ids` thì giới hạn theo các id đó. */
  private byIds(ids: string[] | undefined): SQL {
    return and(
      isNull(customers.deletedAt),
      isNull(customers.linkedBranchId),
      ids ? inArray(customers.id, ids) : undefined,
    )!;
  }

  private async mustExist(db: DbOrTx, id: string): Promise<CustomerRow> {
    const [c] = await db
      .select()
      .from(customers)
      .where(this.byIds([id]));
    if (!c) throw notFound();
    return c;
  }

  private async lockEditable(
    tx: DbOrTx,
    id: string,
  ): Promise<CustomerRow> {
    const [c] = await tx
      .select()
      .from(customers)
      .where(this.byIds([id]))
      .for('update');
    if (!c) throw notFound();
    return c;
  }

  private async assertSalesOwner(db: DbOrTx, userId: string): Promise<void> {
    const [u] = await db
      .select({ id: users.id, role: users.role, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, userId));
    if (!u || !u.isActive || u.role === 'pending') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Nhân viên phụ trách không hợp lệ', [
        {
          field: 'salesOwnerId',
          message: 'Phải là người dùng đang hoạt động',
        },
      ]);
    }
  }

  /** Cảnh báo mềm: số điện thoại này đang gắn với khách khác. */
  private async phoneWarnings(
    db: DbOrTx,
    c: { id: string; phone: string | null },
  ): Promise<CustomerWarningDto[]> {
    if (!c.phone) return [];
    const others = await db
      .select({ id: customers.id, code: customers.code, name: customers.name })
      .from(customers)
      .where(
        and(
          eq(customers.phone, c.phone),
          ne(customers.id, c.id),
          isNull(customers.deletedAt),
        ),
      )
      .orderBy(asc(customers.code))
      .limit(10);
    if (others.length === 0) return [];
    return [
      {
        code: 'DUPLICATE_PHONE',
        message: `Số điện thoại này cũng đang dùng cho ${others.length} khách khác`,
        customers: others,
      },
    ];
  }

  /** Gắn số liệu tính ra, MỖI CHI NHÁNH MỘT BỘ SỐ (không cộng gộp). */
  private async toDtos(
    db: DbOrTx,
    rows: Row[],
    branches: Branch[],
    user: AuthUser,
    debtScope: PermissionScope | null,
  ): Promise<CustomerDto[]> {
    const ids = rows.map((r) => r.c.id);
    const branchIds = branches.map((b) => b.id);
    const key = (customerId: string, branchId: string) =>
      `${customerId}|${branchId}`;
    const profiles = new Map<string, ProfileRow>();
    const lastVisit = new Map<string, string>();
    const sales = new Map<string, string>();
    const returned = new Map<string, string>();
    const lastTx = new Map<string, Date>();
    const debtBy = new Map<string, string>();
    const terms = new Map<
      string,
      { creditLimit: string | null; paymentTermDays: number | null }
    >();
    if (ids.length > 0) {
      for (const p of await db
        .select()
        .from(customerProfiles)
        .where(inArray(customerProfiles.customerId, ids))) {
        profiles.set(p.customerId, p);
      }
      for (const v of await db
        .select({
          id: customerVisits.customerId,
          last: sql<string>`to_char(max(${customerVisits.visitedOn}), 'YYYY-MM-DD')`,
        })
        .from(customerVisits)
        .where(inArray(customerVisits.customerId, ids))
        .groupBy(customerVisits.customerId)) {
        lastVisit.set(v.id, v.last);
      }
    }
    if (ids.length > 0 && branchIds.length > 0) {
      for (const r of await db
        .select({
          id: invoices.customerId,
          branchId: invoices.branchId,
          sum: sql<string>`sum(${invoices.total})`,
          last: sql`max(${invoices.invoicedAt})`.mapWith(invoices.invoicedAt),
        })
        .from(invoices)
        .where(
          and(
            inArray(invoices.customerId, ids),
            inArray(invoices.branchId, branchIds),
            eq(invoices.status, 'completed'),
          ),
        )
        .groupBy(invoices.customerId, invoices.branchId)) {
        sales.set(key(r.id, r.branchId), r.sum);
        lastTx.set(key(r.id, r.branchId), r.last);
      }
      for (const r of await db
        .select({
          id: salesReturns.customerId,
          branchId: salesReturns.branchId,
          sum: sql<string>`sum(${salesReturns.total})`,
        })
        .from(salesReturns)
        .where(
          and(
            inArray(salesReturns.customerId, ids),
            inArray(salesReturns.branchId, branchIds),
            eq(salesReturns.status, 'completed'),
          ),
        )
        .groupBy(salesReturns.customerId, salesReturns.branchId)) {
        returned.set(key(r.id, r.branchId), r.sum);
      }
      if (debtScope) {
        for (const d of await db
          .select({
            id: debtLedger.partyId,
            branchId: debtLedger.branchId,
            sum: sql<string>`sum(${debtLedger.amount})`,
          })
          .from(debtLedger)
          .where(
            and(
              eq(debtLedger.partyType, 'customer'),
              inArray(debtLedger.partyId, ids),
              inArray(debtLedger.branchId, branchIds),
            ),
          )
          .groupBy(debtLedger.partyId, debtLedger.branchId)) {
          debtBy.set(key(d.id, d.branchId), d.sum);
        }
        for (const t of await db
          .select()
          .from(customerBranchTerms)
          .where(
            and(
              inArray(customerBranchTerms.customerId, ids),
              inArray(customerBranchTerms.branchId, branchIds),
            ),
          )) {
          terms.set(key(t.customerId, t.branchId), {
            creditLimit: t.creditLimit,
            paymentTermDays: t.paymentTermDays,
          });
        }
      }
    }

    return rows.map(({ c, ownerName, createdByName }) => {
      const visible = seesMoney(debtScope, user, c);
      const figures = branches.map((b): CustomerBranchFiguresDto => {
        const k = key(c.id, b.id);
        const total = dec(sales.get(k) ?? '0');
        const f: CustomerBranchFiguresDto = {
          branchId: b.id,
          branchCode: b.code,
          branchName: b.name,
          totalSales: total.toFixed(0),
          netSales: total.minus(dec(returned.get(k) ?? '0')).toFixed(0),
          lastTransactionAt: lastTx.get(k)?.toISOString() ?? null,
        };
        if (visible) {
          f.balance = dec(debtBy.get(k) ?? '0').toFixed(0);
          const t = terms.get(k);
          f.creditLimit = t?.creditLimit ?? null;
          f.paymentTermDays = t?.paymentTermDays ?? null;
        }
        return f;
      });
      return {
        id: c.id,
        code: c.code,
        name: c.name,
        phone: c.phone,
        address: c.address,
        salesOwner:
          c.salesOwnerId && ownerName
            ? { id: c.salesOwnerId, fullName: ownerName }
            : null,
        priceLevel: c.priceLevel,
        newSince: c.newSince,
        acquisitionSource: c.acquisitionSource,
        note: c.note,
        isActive: c.isActive,
        isInternalBranch: c.linkedBranchId !== null,
        profile: profileDto(profiles.get(c.id)),
        lastVisitedOn: lastVisit.get(c.id) ?? null,
        branches: figures,
        createdByName,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      };
    });
  }

  private async codeTaken(db: DbOrTx, code: string): Promise<boolean> {
    const [dup] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(sql`lower(${customers.code}) = lower(${code})`);
    return dup !== undefined;
  }

  private async assertCodeFree(db: DbOrTx, code: string): Promise<void> {
    if (await this.codeTaken(db, code)) throw duplicateCode();
  }
}

// ---------------------------------------------------------------- hàm thuần

/** Có được thấy tiền (công nợ, hạn mức) của khách này không. */
function seesMoney(
  scope: PermissionScope | null,
  user: AuthUser,
  c: { salesOwnerId: string | null },
): boolean {
  if (scope === 'all') return true;
  return scope === 'own' && c.salesOwnerId === user.id;
}

function assertCanEdit(
  user: AuthUser,
  scope: PermissionScope,
  c: { salesOwnerId: string | null },
): void {
  if (scope === 'own' && c.salesOwnerId !== user.id) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'Bạn chỉ được sửa khách do chính mình phụ trách',
      { permission: 'customer.edit' },
    );
  }
}

/** Nợ > 0 (đang nợ) hoặc không nợ, TẠI một chi nhánh. */
function debtCondition(branchId: string, hasDebt: boolean): SQL {
  const balance = sql`coalesce((select sum(${debtLedger.amount}) from ${debtLedger} where ${debtLedger.partyType} = 'customer' and ${debtLedger.partyId} = ${customers.id} and ${debtLedger.branchId} = ${branchId}), 0)`;
  return hasDebt ? sql`${balance} > 0` : sql`${balance} <= 0`;
}

export function cleanText(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/** Chuẩn hóa số điện thoại; rỗng → null; sai định dạng → 400. */
function cleanPhone(v: string | null | undefined): string | null {
  const t = v?.trim();
  if (!t) return null;
  const p = normalizeVnPhone(t);
  if (!p) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Số điện thoại không hợp lệ', [
      { field: 'phone', message: 'Số điện thoại không hợp lệ' },
    ]);
  }
  return p;
}

function auditView(c: CustomerRow) {
  return {
    code: c.code,
    name: c.name,
    phone: c.phone,
    address: c.address,
    salesOwnerId: c.salesOwnerId,
    priceLevel: c.priceLevel,
    newSince: c.newSince,
    acquisitionSource: c.acquisitionSource,
    note: c.note,
    isActive: c.isActive,
  };
}

function profileDto(p: ProfileRow | undefined): CustomerProfileDto | null {
  if (!p) return null;
  return {
    warehouseLocation: p.warehouseLocation,
    warehouseCount: p.warehouseCount,
    warehouseArea: p.warehouseArea,
    warehousePhotoUrl: p.warehousePhotoUrl,
    competitors: p.competitors,
    salesMethods: p.salesMethods ?? [],
    scale: p.scale,
  };
}

/** Sắp hình thức bán theo thứ tự chuẩn, bỏ trùng. */
export function canonicalMethods(values: readonly string[]): string[] {
  const set = new Set(values);
  return CUSTOMER_SALES_METHODS.filter((m) => set.has(m));
}

/**
 * Ghi hồ sơ kho: `undefined` = không đụng; `null` = xóa hồ sơ; object = gộp các trường có mặt vào hồ sơ hiện có
 * (rỗng hết thì xóa dòng). Trả trạng thái sau cùng để ghi nhật ký.
 */
export async function applyProfile(
  tx: DbOrTx,
  customerId: string,
  input: CustomerProfileInputDto | null | undefined,
): Promise<CustomerProfileDto | null | undefined> {
  if (input === undefined) return undefined;
  if (input === null) {
    await tx
      .delete(customerProfiles)
      .where(eq(customerProfiles.customerId, customerId));
    return null;
  }
  const [cur] = await tx
    .select()
    .from(customerProfiles)
    .where(eq(customerProfiles.customerId, customerId));
  const next = {
    warehouseLocation:
      input.warehouseLocation !== undefined
        ? cleanText(input.warehouseLocation)
        : (cur?.warehouseLocation ?? null),
    warehouseCount:
      input.warehouseCount !== undefined
        ? input.warehouseCount
        : (cur?.warehouseCount ?? null),
    warehouseArea:
      input.warehouseArea !== undefined
        ? cleanText(input.warehouseArea)
        : (cur?.warehouseArea ?? null),
    warehousePhotoUrl:
      input.warehousePhotoUrl !== undefined
        ? cleanText(input.warehousePhotoUrl)
        : (cur?.warehousePhotoUrl ?? null),
    competitors:
      input.competitors !== undefined
        ? cleanText(input.competitors)
        : (cur?.competitors ?? null),
    salesMethods:
      input.salesMethods !== undefined
        ? canonicalMethods(input.salesMethods)
        : (cur?.salesMethods ?? []),
    scale:
      input.scale !== undefined ? cleanText(input.scale) : (cur?.scale ?? null),
  };
  const empty =
    next.warehouseLocation === null &&
    next.warehouseCount === null &&
    next.warehouseArea === null &&
    next.warehousePhotoUrl === null &&
    next.competitors === null &&
    next.salesMethods.length === 0 &&
    next.scale === null;
  if (empty) {
    await tx
      .delete(customerProfiles)
      .where(eq(customerProfiles.customerId, customerId));
    return null;
  }
  await tx
    .insert(customerProfiles)
    .values({ customerId, ...next })
    .onConflictDoUpdate({
      target: customerProfiles.customerId,
      set: { ...next, updatedAt: new Date() },
    });
  return next;
}

/** "T6/26" (+ "-Page"); khách cũ ghi "Cũ". Đúng cách ghi của file TKS. */
export function formatNewCustomer(
  newSince: string | null,
  source: string | null,
): string {
  const base = newSince
    ? `T${Number(newSince.slice(5, 7))}/${newSince.slice(2, 4)}`
    : 'Cũ';
  return source ? `${base}-${source}` : base;
}

/** YYYY-MM-DD → dd/mm/yyyy. */
export function isoToVn(d: string): string {
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

/** Hôm nay theo giờ Việt Nam, dạng YYYY-MM-DD. */
export function todayVn(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

export function isRealDate(d: string): boolean {
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

function notFound(): AppError {
  return new AppError(404, 'NOT_FOUND', 'Không tìm thấy khách hàng');
}

function duplicateCode(): AppError {
  return new AppError(409, 'DUPLICATE_CODE', 'Mã khách hàng đã tồn tại', [
    { field: 'code', message: 'Mã khách hàng đã tồn tại' },
  ]);
}

function rethrowDuplicateCode(e: unknown): never {
  if (uniqueViolation(e)) throw duplicateCode();
  throw e;
}
