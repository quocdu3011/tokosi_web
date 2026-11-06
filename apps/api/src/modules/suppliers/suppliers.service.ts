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
import { AppError } from '../../common/app-error.js';
import type { AuthUser } from '../../common/auth-user.js';
import { dec } from '../../common/costing.js';
import {
  writeSheet,
  type CellValue,
  type SheetColumn,
} from '../../common/excel.js';
import { pageMeta, pageParams, parseSort } from '../../common/pagination.js';
import { formatVnDateTime, vnDayStart } from '../../common/vn-date.js';
import { uniqueViolation } from '../../common/pg-errors.js';
import { nextFreeDocumentCode } from '../../db/code-sequence.js';
import { DB, type Database, type DbOrTx } from '../../db/database.module.js';
import { searchWhere } from '../../db/search.js';
import { supplierSearchExpr } from '../../db/schema/_search.js';
import {
  debtLedger,
  goodsReceipts,
  purchaseReturns,
  supplierBranchHistory,
  suppliers,
  users,
} from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';
import { PermissionsService } from '../authorization/permissions.service.js';
import { BranchAccessService } from '../branches/branch-access.service.js';
import {
  SUPPLIER_SORT_FIELDS,
  type CreateSupplierDto,
  type LedgerDto,
  type LedgerQueryDto,
  type ListSuppliersQueryDto,
  type SupplierBranchDto,
  type SupplierDto,
  type UpdateSupplierDto,
} from './suppliers.dto.js';

export const SUPPLIER_EXPORT_MAX_ROWS = 10_000;

type SupplierRow = typeof suppliers.$inferSelect;
interface Branch {
  id: string;
  code: string;
  name: string;
}
interface Money {
  totalPurchase: string;
  netPurchase: string;
  balance?: string;
}

/**
 * Nhà cung cấp. Mọi số tiền (nợ, tổng mua) là RIÊNG TỪNG CHI NHÁNH, không bao giờ cộng gộp giữa các chi nhánh. Không
 * lưu nợ: nợ = tổng `debt_ledger` của nhà cung cấp tại chi nhánh đó. Nhà cung cấp hệ thống đại diện chi nhánh
 * (`linked_branch_id`, dùng cho chuyển kho) không xuất hiện ở đây và không sửa được.
 */
@Injectable()
export class SuppliersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly auditLog: AuditService,
    private readonly permissions: PermissionsService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  async list(
    user: AuthUser,
    branchId: string,
    q: ListSuppliersQueryDto,
    mode: 'page' | 'export' = 'page',
  ) {
    const canSeeDebt = await this.permissions.has(user.role, 'debt.view');
    if (q.hasDebt !== undefined && !canSeeDebt) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Bạn không có quyền xem công nợ nên không lọc theo nợ được',
        { permission: 'debt.view' },
      );
    }
    const branch = await this.workingBranch(user, branchId);

    const conditions: Array<SQL | undefined> = [
      isNull(suppliers.deletedAt),
      isNull(suppliers.linkedBranchId),
      searchWhere(supplierSearchExpr(suppliers), q.q),
      q.groupName?.trim()
        ? sql`f_search_text(coalesce(${suppliers.groupName}, '')) = f_search_text(${q.groupName.trim()})`
        : undefined,
      q.isActive === undefined ? undefined : eq(suppliers.isActive, q.isActive),
      q.hasDebt === undefined ? undefined : debtCondition(branchId, q.hasDebt),
    ];
    const where = and(...conditions);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(suppliers)
      .where(where);

    const sort = parseSort(q.sort, SUPPLIER_SORT_FIELDS);
    const direction = sort?.desc ? desc : asc;
    const sortColumn =
      sort?.field === 'name'
        ? suppliers.name
        : sort?.field === 'createdAt'
          ? suppliers.createdAt
          : suppliers.code;
    const { page, limit, offset } =
      mode === 'export'
        ? { page: 1, limit: SUPPLIER_EXPORT_MAX_ROWS, offset: 0 }
        : pageParams(q);

    const rows = await this.db
      .select({ s: suppliers, createdByName: users.fullName })
      .from(suppliers)
      .leftJoin(users, eq(users.id, suppliers.createdBy))
      .where(where)
      .orderBy(direction(sortColumn), asc(suppliers.id))
      .limit(limit)
      .offset(offset);

    const dtos = await this.toDtos(this.db, rows, [branch], canSeeDebt);
    return {
      data: dtos.map((x) => x.dto),
      meta: pageMeta(page, limit, total),
    };
  }

  /** Xuất Excel theo đúng bộ lọc, số tiền của chi nhánh làm việc; cột Nợ chỉ có khi có debt.view. */
  async exportXlsx(
    user: AuthUser,
    branchId: string,
    q: ListSuppliersQueryDto,
  ): Promise<Buffer> {
    const { data } = await this.list(user, branchId, q, 'export');
    const withDebt = data.some((s) => s.balance !== undefined);
    const num = (v: string | undefined): CellValue =>
      v === undefined ? null : Number(v);
    const columns: SheetColumn[] = [
      { header: 'Mã nhà cung cấp', width: 16 },
      { header: 'Tên nhà cung cấp', width: 38 },
      { header: 'Nhóm nhà cung cấp', width: 20 },
      ...(withDebt ? [{ header: 'Nợ cần trả hiện tại', width: 20 }] : []),
      { header: 'Tổng mua', width: 18 },
      { header: 'Tổng mua trừ trả hàng', width: 22 },
      { header: 'Trạng thái', width: 12 },
      { header: 'Người tạo', width: 22 },
      { header: 'Ngày tạo', width: 20 },
    ];
    const rows = data.map((s): CellValue[] => [
      s.code,
      s.name,
      s.groupName,
      ...(withDebt ? [num(s.balance)] : []),
      num(s.totalPurchase),
      num(s.netPurchase),
      s.isActive ? 1 : 0,
      s.createdByName,
      formatVnDateTime(s.createdAt),
    ]);
    return writeSheet('Nhà cung cấp', columns, rows);
  }

  async get(
    user: AuthUser,
    branchId: string,
    id: string,
  ): Promise<SupplierDto> {
    const canSeeDebt = await this.permissions.has(user.role, 'debt.view');
    const branch = await this.workingBranch(user, branchId);
    const rows = await this.rowsOf(this.db, [id]);
    if (rows.length === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy nhà cung cấp');
    }
    return (await this.toDtos(this.db, rows, [branch], canSeeDebt))[0]!.dto;
  }

  /** Số tiền của một nhà cung cấp tại TỪNG chi nhánh người dùng được phép (không cộng gộp). */
  async branchesOf(user: AuthUser, id: string): Promise<SupplierBranchDto[]> {
    const canSeeDebt = await this.permissions.has(user.role, 'debt.view');
    const allowed = await this.branchAccess.listAllowed(user);
    const rows = await this.rowsOf(this.db, [id]);
    if (rows.length === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy nhà cung cấp');
    }
    const [{ perBranch }] = await this.toDtos(
      this.db,
      rows,
      allowed,
      canSeeDebt,
    );
    return allowed.map((b) => {
      const m = perBranch.get(b.id)!;
      const dto: SupplierBranchDto = {
        branchId: b.id,
        branchCode: b.code,
        branchName: b.name,
        totalPurchase: m.totalPurchase,
        netPurchase: m.netPurchase,
      };
      if (m.balance !== undefined) dto.balance = m.balance;
      return dto;
    });
  }

  /**
   * Sổ công nợ của nhà cung cấp TẠI chi nhánh làm việc: số dư đầu kỳ (trước `from`), các dòng sổ cái trong khoảng
   * ngày kèm số dư cộng dồn, số dư cuối kỳ. Chỉ đọc `debt_ledger` (nguồn duy nhất của nợ).
   */
  async ledger(
    branchId: string,
    id: string,
    q: LedgerQueryDto,
  ): Promise<LedgerDto> {
    const rows = await this.rowsOf(this.db, [id]);
    if (rows.length === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy nhà cung cấp');
    }
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
      eq(debtLedger.partyType, 'supplier'),
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

  async create(
    user: AuthUser,
    branchId: string,
    input: CreateSupplierDto,
  ): Promise<SupplierDto> {
    const id = await this.db
      .transaction(async (tx) => {
        if (input.code) await this.assertCodeFree(tx, input.code);
        const [row] = await tx
          .insert(suppliers)
          .values({
            code:
              input.code ??
              (await nextFreeDocumentCode(tx, DOCUMENT_PREFIX.supplier, (c) =>
                this.codeTaken(tx, c),
              )),
            name: input.name.trim(),
            groupName: cleanGroup(input.groupName),
            createdBy: user.id,
          })
          .returning();
        await this.auditLog.record(tx, {
          action: 'supplier.create',
          entityType: 'supplier',
          entityId: row!.id,
          after: auditView(row!),
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
    input: UpdateSupplierDto,
  ): Promise<SupplierDto> {
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, id), isNull(suppliers.deletedAt)))
        .for('update');
      if (!before || before.linkedBranchId) {
        throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy nhà cung cấp');
      }
      const patch: Partial<typeof suppliers.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.groupName !== undefined)
        patch.groupName = cleanGroup(input.groupName);
      if (input.isActive !== undefined) patch.isActive = input.isActive;
      const [after] = await tx
        .update(suppliers)
        .set(patch)
        .where(eq(suppliers.id, id))
        .returning();
      await this.auditLog.record(tx, {
        action: 'supplier.update',
        entityType: 'supplier',
        entityId: id,
        before: auditView(before),
        after: auditView(after!),
      });
    });
    return this.get(user, branchId, id);
  }

  // ------------------------------------------------------------------ nội bộ

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

  private rowsOf(db: DbOrTx, ids: string[]) {
    return db
      .select({ s: suppliers, createdByName: users.fullName })
      .from(suppliers)
      .leftJoin(users, eq(users.id, suppliers.createdBy))
      .where(
        and(
          inArray(suppliers.id, ids),
          isNull(suppliers.deletedAt),
          isNull(suppliers.linkedBranchId),
        ),
      );
  }

  /**
   * Gắn số liệu tính ra cho một lô nhà cung cấp, MỖI CHI NHÁNH MỘT BỘ SỐ (không bao giờ cộng gộp). `dto` là bộ số
   * của chi nhánh đầu tiên trong `branches` (chi nhánh làm việc); `perBranch` có bộ số của mọi chi nhánh được hỏi.
   */
  private async toDtos(
    db: DbOrTx,
    rows: Array<{ s: SupplierRow; createdByName: string | null }>,
    branches: Branch[],
    canSeeDebt: boolean,
  ): Promise<Array<{ dto: SupplierDto; perBranch: Map<string, Money> }>> {
    const ids = rows.map((r) => r.s.id);
    const branchIds = branches.map((b) => b.id);
    // khóa = `${nhà cung cấp}|${chi nhánh}`
    const key = (supplierId: string, branchId: string) =>
      `${supplierId}|${branchId}`;
    const history = new Map<string, { total: string; net: string }>();
    const bought = new Map<string, string>();
    const returned = new Map<string, string>();
    const debtBy = new Map<string, string>();
    if (ids.length > 0 && branchIds.length > 0) {
      const hist = await db
        .select()
        .from(supplierBranchHistory)
        .where(
          and(
            inArray(supplierBranchHistory.supplierId, ids),
            inArray(supplierBranchHistory.branchId, branchIds),
          ),
        );
      for (const h of hist) {
        history.set(key(h.supplierId, h.branchId), {
          total: h.purchaseTotal,
          net: h.purchaseNet,
        });
      }
      const receipts = await db
        .select({
          id: goodsReceipts.supplierId,
          branchId: goodsReceipts.branchId,
          sum: sql<string>`sum(${goodsReceipts.total})`,
        })
        .from(goodsReceipts)
        .where(
          and(
            inArray(goodsReceipts.supplierId, ids),
            inArray(goodsReceipts.branchId, branchIds),
            eq(goodsReceipts.status, 'completed'),
          ),
        )
        .groupBy(goodsReceipts.supplierId, goodsReceipts.branchId);
      for (const r of receipts) bought.set(key(r.id, r.branchId), r.sum);
      const returns = await db
        .select({
          id: purchaseReturns.supplierId,
          branchId: purchaseReturns.branchId,
          sum: sql<string>`sum(${purchaseReturns.total})`,
        })
        .from(purchaseReturns)
        .where(
          and(
            inArray(purchaseReturns.supplierId, ids),
            inArray(purchaseReturns.branchId, branchIds),
            eq(purchaseReturns.status, 'completed'),
          ),
        )
        .groupBy(purchaseReturns.supplierId, purchaseReturns.branchId);
      for (const r of returns) returned.set(key(r.id, r.branchId), r.sum);
      if (canSeeDebt) {
        const debts = await db
          .select({
            id: debtLedger.partyId,
            branchId: debtLedger.branchId,
            sum: sql<string>`sum(${debtLedger.amount})`,
          })
          .from(debtLedger)
          .where(
            and(
              eq(debtLedger.partyType, 'supplier'),
              inArray(debtLedger.partyId, ids),
              inArray(debtLedger.branchId, branchIds),
            ),
          )
          .groupBy(debtLedger.partyId, debtLedger.branchId);
        for (const d of debts) debtBy.set(key(d.id, d.branchId), d.sum);
      }
    }

    return rows.map(({ s, createdByName }) => {
      const perBranch = new Map<string, Money>();
      for (const b of branches) {
        const k = key(s.id, b.id);
        const buy = dec(bought.get(k) ?? '0');
        const ret = dec(returned.get(k) ?? '0');
        const h = history.get(k);
        const m: Money = {
          totalPurchase: dec(h?.total ?? '0')
            .plus(buy)
            .toFixed(0),
          netPurchase: dec(h?.net ?? '0')
            .plus(buy)
            .minus(ret)
            .toFixed(0),
        };
        if (canSeeDebt) m.balance = dec(debtBy.get(k) ?? '0').toFixed(0);
        perBranch.set(b.id, m);
      }
      const first = perBranch.get(branches[0]?.id ?? '') ?? {
        totalPurchase: '0',
        netPurchase: '0',
      };
      const dto: SupplierDto = {
        id: s.id,
        code: s.code,
        name: s.name,
        groupName: s.groupName,
        isActive: s.isActive,
        createdByName,
        createdAt: s.createdAt.toISOString(),
        branchId: branches[0]?.id ?? '',
        ...first,
      };
      return { dto, perBranch };
    });
  }

  private async codeTaken(db: DbOrTx, code: string): Promise<boolean> {
    const [dup] = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(sql`lower(${suppliers.code}) = lower(${code})`);
    return dup !== undefined;
  }

  private async assertCodeFree(db: DbOrTx, code: string): Promise<void> {
    if (await this.codeTaken(db, code)) throw duplicateCode();
  }
}

/** Nợ > 0 (đang nợ) hoặc không nợ, TẠI một chi nhánh. */
function debtCondition(branchId: string, hasDebt: boolean): SQL {
  const balance = sql`coalesce((select sum(${debtLedger.amount}) from ${debtLedger} where ${debtLedger.partyType} = 'supplier' and ${debtLedger.partyId} = ${suppliers.id} and ${debtLedger.branchId} = ${branchId}), 0)`;
  return hasDebt ? sql`${balance} > 0` : sql`${balance} <= 0`;
}

function cleanGroup(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function auditView(s: SupplierRow) {
  return {
    code: s.code,
    name: s.name,
    groupName: s.groupName,
    isActive: s.isActive,
  };
}

function duplicateCode(): AppError {
  return new AppError(409, 'DUPLICATE_CODE', 'Mã nhà cung cấp đã tồn tại', [
    { field: 'code', message: 'Mã nhà cung cấp đã tồn tại' },
  ]);
}

function rethrowDuplicateCode(e: unknown): never {
  if (uniqueViolation(e)) throw duplicateCode();
  throw e;
}
