import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import { dec } from '../../common/costing.js';
import { DB, type Database, type DbOrTx } from '../../db/database.module.js';
import {
  cashAccounts,
  cashCategories,
  cashTransactions,
} from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';
import { notFound } from '../purchasing/purchase-lines.js';
import type {
  CashAccountDto,
  CashCategoryDto,
  CreateCashAccountDto,
  CreateCashCategoryDto,
  ListCashAccountsQueryDto,
  ListCashCategoriesQueryDto,
  UpdateCashAccountDto,
  UpdateCashCategoryDto,
} from './cash-accounts.dto.js';

type AccountRow = typeof cashAccounts.$inferSelect;
type CategoryRow = typeof cashCategories.$inferSelect;

/** Quỹ (tiền mặt / ngân hàng) của chi nhánh và danh mục thu chi. Số dư quỹ KHÔNG lưu: tính từ sổ phiếu. */
@Injectable()
export class CashAccountsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly auditLog: AuditService,
  ) {}

  // ---------------------------------------------------------------- quỹ

  async listAccounts(
    branchId: string,
    q: ListCashAccountsQueryDto,
  ): Promise<CashAccountDto[]> {
    const rows = await this.db
      .select()
      .from(cashAccounts)
      .where(
        and(
          eq(cashAccounts.branchId, branchId),
          q.includeInactive ? undefined : eq(cashAccounts.isActive, true),
        ),
      )
      .orderBy(asc(cashAccounts.type), asc(cashAccounts.name), asc(cashAccounts.id));
    return this.withBalances(this.db, rows);
  }

  async getAccount(
    db: DbOrTx,
    branchId: string,
    id: string,
  ): Promise<CashAccountDto> {
    const [row] = await db
      .select()
      .from(cashAccounts)
      .where(and(eq(cashAccounts.id, id), eq(cashAccounts.branchId, branchId)));
    if (!row) throw notFound('quỹ');
    return (await this.withBalances(db, [row]))[0]!;
  }

  /** Số dư hiện tại của một quỹ (đọc trong transaction đang mở thì thấy cả phiếu vừa ghi). */
  async balanceOf(db: DbOrTx, accountId: string): Promise<string> {
    const [row] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, accountId));
    if (!row) throw notFound('quỹ');
    return (await this.withBalances(db, [row]))[0]!.balance;
  }

  async createAccount(
    branchId: string,
    input: CreateCashAccountDto,
  ): Promise<CashAccountDto> {
    const id = await this.db.transaction(async (tx) => {
      await this.assertAccountNameFree(tx, branchId, input.name);
      const [row] = await tx
        .insert(cashAccounts)
        .values({
          name: input.name.trim(),
          type: input.type,
          branchId,
          openingBalance: input.openingBalance ?? '0',
        })
        .returning();
      await this.auditLog.record(tx, {
        action: 'cash_account.create',
        entityType: 'cash_account',
        entityId: row!.id,
        after: {
          name: row!.name,
          type: row!.type,
          openingBalance: row!.openingBalance,
        },
      });
      return row!.id;
    });
    return this.getAccount(this.db, branchId, id);
  }

  async updateAccount(
    branchId: string,
    id: string,
    input: UpdateCashAccountDto,
  ): Promise<CashAccountDto> {
    await this.db.transaction(async (tx) => {
      // Khóa dòng quỹ: tạo phiếu đầu tiên và sửa số đầu kỳ không được chen nhau
      const [acc] = await tx
        .select()
        .from(cashAccounts)
        .where(and(eq(cashAccounts.id, id), eq(cashAccounts.branchId, branchId)))
        .for('update');
      if (!acc) throw notFound('quỹ');
      const patch: Partial<AccountRow> = {};
      if (input.name !== undefined && input.name.trim() !== acc.name) {
        await this.assertAccountNameFree(tx, branchId, input.name, id);
        patch.name = input.name.trim();
      }
      if (
        input.openingBalance !== undefined &&
        !dec(input.openingBalance).eq(dec(acc.openingBalance))
      ) {
        const [used] = await tx
          .select({ id: cashTransactions.id })
          .from(cashTransactions)
          .where(eq(cashTransactions.accountId, id))
          .limit(1);
        if (used) {
          throw new AppError(
            422,
            'INVALID_STATE',
            'Quỹ đã có phiếu thu/chi, không đổi được quỹ đầu kỳ',
          );
        }
        patch.openingBalance = input.openingBalance;
      }
      if (input.isActive !== undefined) patch.isActive = input.isActive;
      if (Object.keys(patch).length === 0) return;
      await tx
        .update(cashAccounts)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(cashAccounts.id, id));
      await this.auditLog.record(tx, {
        action: 'cash_account.update',
        entityType: 'cash_account',
        entityId: id,
        before: {
          name: acc.name,
          openingBalance: acc.openingBalance,
          isActive: acc.isActive,
        },
        after: patch,
      });
    });
    return this.getAccount(this.db, branchId, id);
  }

  private async assertAccountNameFree(
    db: DbOrTx,
    branchId: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const rows = await db
      .select({ id: cashAccounts.id })
      .from(cashAccounts)
      .where(
        and(
          eq(cashAccounts.branchId, branchId),
          sql`lower(${cashAccounts.name}) = lower(${name.trim()})`,
        ),
      );
    if (rows.some((r) => r.id !== exceptId)) {
      throw new AppError(409, 'DUPLICATE_NAME', 'Tên quỹ đã tồn tại ở chi nhánh', [
        { field: 'name', message: 'Tên quỹ đã tồn tại ở chi nhánh' },
      ]);
    }
  }

  /** Số dư = quỹ đầu kỳ + Σ thu − Σ chi của phiếu hoàn tất. */
  private async withBalances(
    db: DbOrTx,
    rows: AccountRow[],
  ): Promise<CashAccountDto[]> {
    if (rows.length === 0) return [];
    const agg = await db
      .select({
        accountId: cashTransactions.accountId,
        net: sql<string>`coalesce(sum(case when ${cashTransactions.status} = 'completed' then (case when ${cashTransactions.direction} = 'in' then ${cashTransactions.amount} else -${cashTransactions.amount} end) else 0 end), 0)`,
        n: sql<number>`count(*)::int`,
      })
      .from(cashTransactions)
      .where(
        sql`${cashTransactions.accountId} in (${sql.join(
          rows.map((r) => sql`${r.id}`),
          sql`, `,
        )})`,
      )
      .groupBy(cashTransactions.accountId);
    const by = new Map(agg.map((a) => [a.accountId, a]));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      openingBalance: dec(r.openingBalance).toFixed(0),
      balance: dec(r.openingBalance)
        .plus(dec(by.get(r.id)?.net ?? '0'))
        .toFixed(0),
      isActive: r.isActive,
      hasTransactions: (by.get(r.id)?.n ?? 0) > 0,
    }));
  }

  // ---------------------------------------------------------------- danh mục

  async listCategories(q: ListCashCategoriesQueryDto): Promise<CashCategoryDto[]> {
    const rows = await this.db
      .select()
      .from(cashCategories)
      .where(
        and(
          q.direction ? eq(cashCategories.direction, q.direction) : undefined,
          q.includeInactive ? undefined : eq(cashCategories.isActive, true),
        ),
      )
      .orderBy(
        asc(cashCategories.direction),
        asc(cashCategories.sortOrder),
        asc(cashCategories.name),
      );
    return rows.map(toCategory);
  }

  async createCategory(input: CreateCashCategoryDto): Promise<CashCategoryDto> {
    return this.db.transaction(async (tx) => {
      await this.assertCategoryNameFree(tx, input.name, input.direction);
      const [max] = await tx
        .select({ v: sql<number>`coalesce(max(${cashCategories.sortOrder}), 0)::int` })
        .from(cashCategories);
      const [row] = await tx
        .insert(cashCategories)
        .values({
          name: input.name.trim(),
          direction: input.direction,
          sortOrder: (max?.v ?? 0) + 1,
        })
        .returning();
      await this.auditLog.record(tx, {
        action: 'cash_category.create',
        entityType: 'cash_category',
        entityId: row!.id,
        after: { name: row!.name, direction: row!.direction },
      });
      return toCategory(row!);
    });
  }

  async updateCategory(
    id: string,
    input: UpdateCashCategoryDto,
  ): Promise<CashCategoryDto> {
    return this.db.transaction(async (tx) => {
      const [cat] = await tx
        .select()
        .from(cashCategories)
        .where(eq(cashCategories.id, id))
        .for('update');
      if (!cat) throw notFound('danh mục thu chi');
      if (cat.isSystem && input.isActive === false) {
        throw new AppError(
          422,
          'INVALID_STATE',
          'Danh mục hệ thống không ngưng hoạt động được',
        );
      }
      const patch: Partial<CategoryRow> = {};
      if (input.name !== undefined && input.name.trim() !== cat.name) {
        await this.assertCategoryNameFree(tx, input.name, cat.direction, id);
        patch.name = input.name.trim();
      }
      if (input.isActive !== undefined) patch.isActive = input.isActive;
      if (Object.keys(patch).length === 0) return toCategory(cat);
      const [row] = await tx
        .update(cashCategories)
        .set(patch)
        .where(eq(cashCategories.id, id))
        .returning();
      await this.auditLog.record(tx, {
        action: 'cash_category.update',
        entityType: 'cash_category',
        entityId: id,
        before: { name: cat.name, isActive: cat.isActive },
        after: patch,
      });
      return toCategory(row!);
    });
  }

  private async assertCategoryNameFree(
    db: DbOrTx,
    name: string,
    direction: 'in' | 'out',
    exceptId?: string,
  ): Promise<void> {
    const rows = await db
      .select({ id: cashCategories.id })
      .from(cashCategories)
      .where(
        and(
          eq(cashCategories.direction, direction),
          sql`lower(${cashCategories.name}) = lower(${name.trim()})`,
        ),
      );
    if (rows.some((r) => r.id !== exceptId)) {
      throw new AppError(409, 'DUPLICATE_NAME', 'Tên danh mục đã tồn tại', [
        { field: 'name', message: 'Tên danh mục đã tồn tại cùng hướng thu/chi' },
      ]);
    }
  }
}

function toCategory(r: CategoryRow): CashCategoryDto {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    direction: r.direction,
    isSystem: r.isSystem,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
  };
}
