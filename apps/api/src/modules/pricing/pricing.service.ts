import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import type { AuthUser } from '../../common/auth-user.js';
import { dec } from '../../common/costing.js';
import { writeSheet, type CellValue } from '../../common/excel.js';
import { pageMeta, pageParams } from '../../common/pagination.js';
import { categoryWithDescendants } from '../../db/category-tree.js';
import { DB, type Database, type DbOrTx } from '../../db/database.module.js';
import { searchWhere } from '../../db/search.js';
import {
  branches,
  priceBookItems,
  priceBooks,
  products,
  stocks,
} from '../../db/schema/index.js';
import { productSearchExpr } from '../../db/schema/_search.js';
import { AuditService } from '../audit/audit.service.js';
import { PermissionsService } from '../authorization/permissions.service.js';
import { BranchAccessService } from '../branches/branch-access.service.js';
import {
  GRID_MAX_LIMIT,
  type BulkAdjustDto,
  type BulkAdjustResultDto,
  type CopyBranchDto,
  type CopyBranchResultDto,
  type GridDto,
  type GridQueryDto,
  type PriceBookDto,
  type SaveGridDto,
  type SaveGridResultDto,
  type UpdatePriceBookDto,
} from './pricing.dto.js';

const PREVIEW_LIMIT = 200;
/** Số thay đổi tối đa đưa vào một bản ghi nhật ký (phần còn lại chỉ ghi tổng số). */
const AUDIT_DETAIL_LIMIT = 200;

type BookRow = typeof priceBooks.$inferSelect;

@Injectable()
export class PricingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly auditLog: AuditService,
    private readonly permissions: PermissionsService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  // ------------------------------------------------------------------ bảng giá

  async listBooks(): Promise<PriceBookDto[]> {
    const rows = await this.db
      .select()
      .from(priceBooks)
      .orderBy(asc(priceBooks.sortOrder), asc(priceBooks.code));
    return rows.map(toBookDto);
  }

  async updateBook(
    id: string,
    input: UpdatePriceBookDto,
  ): Promise<PriceBookDto> {
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(priceBooks)
        .where(eq(priceBooks.id, id))
        .for('update');
      if (!before)
        throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy bảng giá');
      if (input.isActive === false && before.isDefault) {
        throw new AppError(
          400,
          'INVALID_STATE',
          'Không tắt được Bảng giá chung: các bảng khác lùi về bảng này khi thiếu giá',
        );
      }
      const patch: Partial<typeof priceBooks.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) {
        const name = input.name.trim();
        const [dup] = await tx
          .select({ id: priceBooks.id })
          .from(priceBooks)
          .where(
            and(
              sql`lower(${priceBooks.name}) = lower(${name})`,
              sql`${priceBooks.id} <> ${id}`,
            ),
          );
        if (dup) {
          throw new AppError(409, 'DUPLICATE_NAME', 'Đã có bảng giá cùng tên', [
            { field: 'name', message: 'Tên bảng giá đã được dùng' },
          ]);
        }
        patch.name = name;
      }
      if (input.isActive !== undefined) patch.isActive = input.isActive;
      const [after] = await tx
        .update(priceBooks)
        .set(patch)
        .where(eq(priceBooks.id, id))
        .returning();
      await this.auditLog.record(tx, {
        action: 'price_book.update',
        entityType: 'price_book',
        entityId: id,
        before: { name: before.name, isActive: before.isActive },
        after: { name: after!.name, isActive: after!.isActive },
      });
      return toBookDto(after!);
    });
  }

  // ------------------------------------------------------------------ lưới giá

  /** Chi nhánh của lưới: tham số rõ ràng (phải được phép) hoặc chi nhánh làm việc theo header. */
  async resolveBranch(
    user: AuthUser,
    explicit: string | undefined,
    headerBranch: string | undefined,
  ): Promise<string> {
    if (explicit) {
      await this.branchAccess.assertAccess(user, explicit);
      return explicit;
    }
    return this.branchAccess.resolveWorkingBranch(user, headerBranch);
  }

  async grid(
    user: AuthUser,
    branchId: string,
    q: GridQueryDto,
    mode: 'page' | 'export' = 'page',
  ): Promise<GridDto> {
    const canSeeCost = await this.permissions.has(
      user.role,
      'product.cost.view',
    );
    const books = await this.db
      .select()
      .from(priceBooks)
      .where(eq(priceBooks.isActive, true))
      .orderBy(asc(priceBooks.sortOrder), asc(priceBooks.code));
    const categoryIds = q.categoryId
      ? await categoryWithDescendants(this.db, q.categoryId)
      : undefined;
    const where = and(
      isNull(products.deletedAt),
      searchWhere(productSearchExpr(products), q.q),
      categoryIds ? inArray(products.categoryId, categoryIds) : undefined,
    );
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(products)
      .where(where);
    const { page, limit, offset } =
      mode === 'export'
        ? { page: 1, limit: 10_000, offset: 0 }
        : pageParams({ page: q.page, limit: q.limit ?? 50 }, GRID_MAX_LIMIT);

    const rows = await this.db
      .select({
        id: products.id,
        code: products.code,
        name: products.name,
        costPrice: stocks.costPrice,
      })
      .from(products)
      .leftJoin(
        stocks,
        and(eq(stocks.productId, products.id), eq(stocks.branchId, branchId)),
      )
      .where(where)
      .orderBy(asc(products.code), asc(products.id))
      .limit(limit)
      .offset(offset);

    const prices =
      rows.length === 0
        ? []
        : await this.db
            .select()
            .from(priceBookItems)
            .where(
              and(
                eq(priceBookItems.branchId, branchId),
                inArray(
                  priceBookItems.productId,
                  rows.map((r) => r.id),
                ),
              ),
            );
    const byProduct = new Map<string, Map<string, string>>();
    for (const p of prices) {
      const m = byProduct.get(p.productId) ?? new Map<string, string>();
      m.set(p.priceBookId, dec(p.price).toFixed());
      byProduct.set(p.productId, m);
    }
    return {
      branchId,
      books: books.map((b) => ({ id: b.id, code: b.code, name: b.name })),
      data: rows.map((r) => {
        const own = byProduct.get(r.id);
        const row: GridDto['data'][number] = {
          productId: r.id,
          code: r.code,
          name: r.name,
          prices: Object.fromEntries(
            books.map((b) => [b.id, own?.get(b.id) ?? null]),
          ),
        };
        if (canSeeCost) row.costPrice = r.costPrice ?? '0.0000';
        return row;
      }),
      meta: pageMeta(page, limit, total),
    };
  }

  /** Xuất lưới giá ra Excel (một cột mỗi bảng giá, tiêu đề là tên bảng giá để nhập lại được). */
  async gridXlsx(
    user: AuthUser,
    branchId: string,
    q: GridQueryDto,
  ): Promise<Buffer> {
    const g = await this.grid(user, branchId, q, 'export');
    const withCost = g.data.some((r) => r.costPrice !== undefined);
    const toNum = (v: string | null | undefined): CellValue =>
      v === null || v === undefined ? null : Number(v);
    return writeSheet(
      'Bảng giá',
      [
        { header: 'Mã hàng', width: 16 },
        { header: 'Tên hàng', width: 38 },
        ...(withCost ? [{ header: 'Giá vốn', width: 14 }] : []),
        ...g.books.map((b) => ({ header: b.name, width: 16 })),
      ],
      g.data.map((r): CellValue[] => [
        r.code,
        r.name,
        ...(withCost ? [toNum(r.costPrice)] : []),
        ...g.books.map((b) => toNum(r.prices[b.id])),
      ]),
    );
  }

  /**
   * Lưu nhiều ô giá cùng lúc. Các ô được xử lý theo thứ tự cố định (bảng giá, sản phẩm) để hai người lưu cùng lúc
   * không chờ nhau mãi (bế tắc). Tất cả hoặc không gì cả.
   */
  async saveGrid(
    user: AuthUser,
    input: SaveGridDto,
  ): Promise<SaveGridResultDto> {
    await this.assertBranch(user, input.branchId);
    const seen = new Set<string>();
    for (const c of input.changes) {
      const key = `${c.priceBookId}|${c.productId}`;
      if (seen.has(key)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Có ô giá bị gửi trùng', [
          {
            field: 'changes',
            message: 'Mỗi cặp (sản phẩm, bảng giá) chỉ được xuất hiện một lần',
          },
        ]);
      }
      seen.add(key);
    }
    await this.assertExist(
      this.db,
      input.changes.map((c) => c.productId),
      input.changes.map((c) => c.priceBookId),
    );
    const sorted = [...input.changes].sort(
      (a, b) =>
        a.priceBookId.localeCompare(b.priceBookId) ||
        a.productId.localeCompare(b.productId),
    );

    return this.db.transaction(async (tx) => {
      const details: Array<{
        productId: string;
        priceBookId: string;
        old: string | null;
        new: string | null;
      }> = [];
      for (const c of sorted) {
        const [old] = await tx
          .select()
          .from(priceBookItems)
          .where(
            and(
              eq(priceBookItems.priceBookId, c.priceBookId),
              eq(priceBookItems.branchId, input.branchId),
              eq(priceBookItems.productId, c.productId),
            ),
          )
          .for('update');
        const oldPrice = old ? dec(old.price).toFixed() : null;
        const newPrice = c.price === null ? null : dec(c.price).toFixed();
        if (oldPrice === newPrice) continue;
        if (newPrice === null) {
          await tx
            .delete(priceBookItems)
            .where(
              and(
                eq(priceBookItems.priceBookId, c.priceBookId),
                eq(priceBookItems.branchId, input.branchId),
                eq(priceBookItems.productId, c.productId),
              ),
            );
        } else {
          await tx
            .insert(priceBookItems)
            .values({
              priceBookId: c.priceBookId,
              branchId: input.branchId,
              productId: c.productId,
              price: newPrice,
              updatedBy: user.id,
            })
            .onConflictDoUpdate({
              target: [
                priceBookItems.priceBookId,
                priceBookItems.branchId,
                priceBookItems.productId,
              ],
              set: {
                price: newPrice,
                updatedBy: user.id,
                updatedAt: new Date(),
              },
            });
        }
        details.push({
          productId: c.productId,
          priceBookId: c.priceBookId,
          old: oldPrice,
          new: newPrice,
        });
      }
      if (details.length > 0) {
        await this.auditLog.record(tx, {
          action: 'price.grid_save',
          entityType: 'price_book_items',
          branchId: input.branchId,
          after: {
            updated: details.length,
            changes: details.slice(0, AUDIT_DETAIL_LIMIT),
          },
        });
      }
      return { updated: details.length };
    });
  }

  // ------------------------------------------------------------------ tăng/giảm hàng loạt

  async bulkAdjust(
    user: AuthUser,
    input: BulkAdjustDto,
  ): Promise<BulkAdjustResultDto> {
    await this.assertBranch(user, input.branchId);
    const [book] = await this.db
      .select()
      .from(priceBooks)
      .where(eq(priceBooks.id, input.priceBookId));
    if (!book) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy bảng giá');
    const categoryIds = input.categoryId
      ? await categoryWithDescendants(this.db, input.categoryId)
      : undefined;
    const value = new Decimal(input.value);
    const roundTo = new Decimal(input.roundTo ?? '1');

    const run = async (db: DbOrTx): Promise<BulkAdjustResultDto> => {
      const items = await db
        .select({
          productId: priceBookItems.productId,
          code: products.code,
          price: priceBookItems.price,
        })
        .from(priceBookItems)
        .innerJoin(products, eq(products.id, priceBookItems.productId))
        .where(
          and(
            eq(priceBookItems.priceBookId, input.priceBookId),
            eq(priceBookItems.branchId, input.branchId),
            isNull(products.deletedAt),
            categoryIds ? inArray(products.categoryId, categoryIds) : undefined,
          ),
        )
        .orderBy(asc(priceBookItems.productId))
        // khóa các ô theo thứ tự sản phẩm khi lưu thật; xem trước thì không cần khóa
        .for(input.dryRun ? 'no key update' : 'update', { of: priceBookItems });

      const changes: Array<{
        productId: string;
        code: string;
        oldPrice: string;
        newPrice: string;
      }> = [];
      let skipped = 0;
      let unchanged = 0;
      for (const it of items) {
        const old = dec(it.price);
        const raw =
          input.mode === 'percent'
            ? old.times(new Decimal(1).plus(value.div(100)))
            : old.plus(value);
        const next = raw
          .div(roundTo)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
          .times(roundTo);
        if (next.isNegative()) {
          skipped++;
          continue;
        }
        if (next.equals(old)) {
          unchanged++;
          continue;
        }
        changes.push({
          productId: it.productId,
          code: it.code,
          oldPrice: old.toFixed(),
          newPrice: next.toFixed(0),
        });
      }

      if (!input.dryRun && changes.length > 0) {
        await db.execute(sql`
          update price_book_items pbi
          set price = v.price, updated_by = ${user.id}, updated_at = now()
          from (
            select unnest(${pgArray(changes.map((c) => c.productId))}::uuid[]) as product_id,
                   unnest(${pgArray(changes.map((c) => c.newPrice))}::numeric[]) as price
          ) v
          where pbi.price_book_id = ${input.priceBookId}
            and pbi.branch_id = ${input.branchId}
            and pbi.product_id = v.product_id`);
        await this.auditLog.record(db, {
          action: 'price.bulk_adjust',
          entityType: 'price_book_items',
          entityId: input.priceBookId,
          branchId: input.branchId,
          after: {
            mode: input.mode,
            value: input.value,
            roundTo: roundTo.toFixed(),
            categoryId: input.categoryId ?? null,
            affected: changes.length,
            skipped,
            unchanged,
            changes: changes.slice(0, AUDIT_DETAIL_LIMIT),
          },
        });
      }
      return {
        dryRun: input.dryRun,
        affected: changes.length,
        skipped,
        unchanged,
        preview: changes.slice(0, PREVIEW_LIMIT),
      };
    };

    return input.dryRun ? run(this.db) : this.db.transaction((tx) => run(tx));
  }

  // ------------------------------------------------------------------ sao chép giữa chi nhánh

  async copyBranch(
    user: AuthUser,
    input: CopyBranchDto,
  ): Promise<CopyBranchResultDto> {
    if (input.fromBranchId === input.toBranchId) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Hai chi nhánh phải khác nhau',
        [
          {
            field: 'toBranchId',
            message: 'Chi nhánh đích phải khác chi nhánh nguồn',
          },
        ],
      );
    }
    await this.assertBranch(user, input.fromBranchId);
    await this.assertBranch(user, input.toBranchId);
    if (input.priceBookId) {
      const [book] = await this.db
        .select({ id: priceBooks.id })
        .from(priceBooks)
        .where(eq(priceBooks.id, input.priceBookId));
      if (!book)
        throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy bảng giá');
    }
    const overwrite = input.overwrite ?? false;

    return this.db.transaction(async (tx) => {
      const bookFilter = input.priceBookId
        ? sql`and price_book_id = ${input.priceBookId}`
        : sql``;
      const [{ n: sourceCount }] = (
        await tx.execute(sql`
          select count(*)::int as n from price_book_items
          where branch_id = ${input.fromBranchId} ${bookFilter}`)
      ).rows as Array<{ n: number }>;

      const onConflict = overwrite
        ? sql`on conflict (price_book_id, branch_id, product_id) do update
              set price = excluded.price, updated_by = excluded.updated_by, updated_at = excluded.updated_at
              where price_book_items.price <> excluded.price`
        : sql`on conflict do nothing`;
      const result = await tx.execute(sql`
        insert into price_book_items (price_book_id, branch_id, product_id, price, updated_by, updated_at)
        select price_book_id, ${input.toBranchId}::uuid, product_id, price, ${user.id}::uuid, now()
        from price_book_items
        where branch_id = ${input.fromBranchId} ${bookFilter}
        order by price_book_id, product_id
        ${onConflict}
        returning 1 as x`);
      const copied = result.rows.length;
      await this.auditLog.record(tx, {
        action: 'price.copy_branch',
        entityType: 'price_book_items',
        branchId: input.toBranchId,
        after: {
          fromBranchId: input.fromBranchId,
          toBranchId: input.toBranchId,
          priceBookId: input.priceBookId ?? null,
          overwrite,
          copied,
          skipped: sourceCount - copied,
        },
      });
      return { copied, skipped: sourceCount - copied };
    });
  }

  // ------------------------------------------------------------------ nội bộ

  private async assertBranch(user: AuthUser, branchId: string): Promise<void> {
    await this.branchAccess.assertAccess(user, branchId);
    const [b] = await this.db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.isActive, true)));
    if (!b) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy chi nhánh');
  }

  private async assertExist(
    db: DbOrTx,
    productIds: string[],
    bookIds: string[],
  ): Promise<void> {
    const pIds = [...new Set(productIds)];
    const bIds = [...new Set(bookIds)];
    const [p] = await db
      .select({ n: count() })
      .from(products)
      .where(and(inArray(products.id, pIds), isNull(products.deletedAt)));
    if (p!.n !== pIds.length) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Có sản phẩm không tồn tại', [
        { field: 'changes', message: 'Có sản phẩm không tồn tại hoặc đã xóa' },
      ]);
    }
    const [b] = await db
      .select({ n: count() })
      .from(priceBooks)
      .where(inArray(priceBooks.id, bIds));
    if (b!.n !== bIds.length) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Có bảng giá không tồn tại', [
        { field: 'changes', message: 'Có bảng giá không tồn tại' },
      ]);
    }
  }
}

function toBookDto(b: BookRow): PriceBookDto {
  return {
    id: b.id,
    code: b.code,
    name: b.name,
    withVat: b.withVat,
    isDefault: b.isDefault,
    isActive: b.isActive,
  };
}

/** Mảng PostgreSQL dạng literal `{a,b,c}` để truyền một tham số rồi ép kiểu (`::uuid[]`, `::numeric[]`). */
function pgArray(values: string[]) {
  return sql`${`{${values.join(',')}}`}`;
}
