import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, isNull } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import { uniqueViolation } from '../../common/pg-errors.js';
import { DB, type Database, type Tx } from '../../db/database.module.js';
import { categories, products } from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';
import type {
  CategoryNodeDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './categories.dto.js';

/** Số cấp tối đa của cây nhóm hàng (giống KiotViet: "Nhóm hàng(3 Cấp)"). */
export const MAX_CATEGORY_DEPTH = 3;

type CategoryRow = typeof categories.$inferSelect;

@Injectable()
export class CategoriesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly auditLog: AuditService,
  ) {}

  async tree(): Promise<CategoryNodeDto[]> {
    const rows = await this.db
      .select()
      .from(categories)
      .where(isNull(categories.deletedAt));
    const counts = await this.db
      .select({ categoryId: products.categoryId, n: count() })
      .from(products)
      .where(isNull(products.deletedAt))
      .groupBy(products.categoryId);
    const own = new Map(counts.map((c) => [c.categoryId, c.n]));

    const children = new Map<string | null, CategoryRow[]>();
    for (const r of rows) {
      const list = children.get(r.parentId) ?? [];
      list.push(r);
      children.set(r.parentId, list);
    }
    const build = (parentId: string | null): CategoryNodeDto[] =>
      (children.get(parentId) ?? [])
        .sort(
          (a, b) =>
            a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'),
        )
        .map((r) => {
          const kids = build(r.id);
          return {
            id: r.id,
            name: r.name,
            parentId: r.parentId,
            productCount:
              (own.get(r.id) ?? 0) +
              kids.reduce((sum, k) => sum + k.productCount, 0),
            children: kids,
          };
        });
    return build(null);
  }

  async create(input: CreateCategoryDto): Promise<CategoryNodeDto> {
    const name = input.name.trim();
    const created = await this.db
      .transaction(async (tx) => {
        const all = await this.lockAll(tx);
        if (input.parentId) {
          const parent = all.get(input.parentId);
          if (!parent) throw this.invalid('parentId', 'Nhóm cha không tồn tại');
          if (depthOf(all, parent.id) >= MAX_CATEGORY_DEPTH) {
            throw this.invalid(
              'parentId',
              `Nhóm hàng tối đa ${MAX_CATEGORY_DEPTH} cấp`,
            );
          }
        }
        const siblings = [...all.values()].filter(
          (c) => c.parentId === (input.parentId ?? null),
        );
        const [row] = await tx
          .insert(categories)
          .values({
            name,
            parentId: input.parentId ?? null,
            sortOrder: Math.max(0, ...siblings.map((s) => s.sortOrder)) + 1,
          })
          .returning();
        await this.auditLog.record(tx, {
          action: 'category.create',
          entityType: 'category',
          entityId: row!.id,
          after: { name, parentId: input.parentId ?? null },
        });
        return row!;
      })
      .catch(rethrowDuplicate);
    return {
      id: created.id,
      name: created.name,
      parentId: created.parentId,
      productCount: 0,
      children: [],
    };
  }

  async update(id: string, input: UpdateCategoryDto): Promise<CategoryNodeDto> {
    await this.db
      .transaction(async (tx) => {
        const all = await this.lockAll(tx);
        const current = all.get(id);
        if (!current) {
          throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy nhóm hàng');
        }
        const patch: Partial<typeof categories.$inferInsert> = {
          updatedAt: new Date(),
        };
        if (input.name !== undefined) patch.name = input.name.trim();

        if (
          input.parentId !== undefined &&
          input.parentId !== current.parentId
        ) {
          const newParentId = input.parentId;
          if (newParentId !== null) {
            const newParent = all.get(newParentId);
            if (!newParent)
              throw this.invalid('parentId', 'Nhóm cha không tồn tại');
            // không được chuyển vào chính nó hoặc nhóm con/cháu của nó (tạo vòng lặp)
            for (
              let cur: CategoryRow | undefined = newParent;
              cur;
              cur = cur.parentId ? all.get(cur.parentId) : undefined
            ) {
              if (cur.id === id) {
                throw new AppError(
                  400,
                  'INVALID_STATE',
                  'Không thể chuyển nhóm vào chính nó hoặc nhóm con của nó',
                );
              }
            }
            if (
              depthOf(all, newParent.id) + heightOf(all, id) >
              MAX_CATEGORY_DEPTH
            ) {
              throw this.invalid(
                'parentId',
                `Nhóm hàng tối đa ${MAX_CATEGORY_DEPTH} cấp`,
              );
            }
          }
          patch.parentId = newParentId;
        }

        const [after] = await tx
          .update(categories)
          .set(patch)
          .where(eq(categories.id, id))
          .returning();
        await this.auditLog.record(tx, {
          action: 'category.update',
          entityType: 'category',
          entityId: id,
          before: { name: current.name, parentId: current.parentId },
          after: { name: after!.name, parentId: after!.parentId },
        });
      })
      .catch(rethrowDuplicate);
    const found = findNode(await this.tree(), id);
    if (!found)
      throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy nhóm hàng');
    return found;
  }

  /** Xóa mềm. Chỉ khi không còn nhóm con và không còn hàng hóa (kể cả hàng đã ngưng bán). */
  async remove(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const all = await this.lockAll(tx);
      const current = all.get(id);
      if (!current) {
        throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy nhóm hàng');
      }
      if ([...all.values()].some((c) => c.parentId === id)) {
        throw new AppError(
          400,
          'INVALID_STATE',
          'Nhóm hàng còn nhóm con, hãy chuyển hoặc xóa nhóm con trước',
        );
      }
      const [{ n }] = await tx
        .select({ n: count() })
        .from(products)
        .where(and(eq(products.categoryId, id), isNull(products.deletedAt)));
      if (n > 0) {
        throw new AppError(
          400,
          'INVALID_STATE',
          `Nhóm hàng còn ${n} hàng hóa, hãy chuyển sang nhóm khác trước`,
          { productCount: n },
        );
      }
      await tx
        .update(categories)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(categories.id, id));
      await this.auditLog.record(tx, {
        action: 'category.delete',
        entityType: 'category',
        entityId: id,
        before: { name: current.name, parentId: current.parentId },
      });
    });
  }

  // ------------------------------------------------------------------ nội bộ

  /**
   * Khóa mọi nhóm chưa xóa (bảng nhỏ, ~100 dòng) theo thứ tự id để các thay đổi cấu trúc cây xếp hàng tuần tự:
   * không thể hai người cùng chuyển nhóm A vào B và B vào A rồi tạo vòng lặp.
   */
  private async lockAll(tx: Tx): Promise<Map<string, CategoryRow>> {
    const rows = await tx
      .select()
      .from(categories)
      .where(isNull(categories.deletedAt))
      .orderBy(categories.id)
      .for('update');
    return new Map(rows.map((r) => [r.id, r]));
  }

  private invalid(field: string, message: string): AppError {
    return new AppError(400, 'VALIDATION_ERROR', message, [{ field, message }]);
  }
}

/** Bắt lỗi trùng chỉ mục tên anh em và đổi thành 409 DUPLICATE_NAME. */
function rethrowDuplicate(e: unknown): never {
  if (uniqueViolation(e)) {
    throw new AppError(
      409,
      'DUPLICATE_NAME',
      'Đã có nhóm hàng cùng tên trong nhóm cha này',
      [{ field: 'name', message: 'Tên nhóm hàng đã được dùng' }],
    );
  }
  throw e;
}

/** Số cấp từ gốc tới nhóm này (gốc = 1). */
function depthOf(all: Map<string, CategoryRow>, id: string): number {
  let depth = 0;
  for (
    let cur = all.get(id);
    cur;
    cur = cur.parentId ? all.get(cur.parentId) : undefined
  ) {
    depth++;
  }
  return depth;
}

/** Chiều cao của cây con có gốc là nhóm này (nhóm không có con = 1). */
function heightOf(all: Map<string, CategoryRow>, id: string): number {
  let max = 0;
  for (const c of all.values()) {
    if (c.parentId === id) max = Math.max(max, heightOf(all, c.id));
  }
  return max + 1;
}

function findNode(
  nodes: CategoryNodeDto[],
  id: string,
): CategoryNodeDto | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const inner = findNode(n.children, id);
    if (inner) return inner;
  }
  return undefined;
}
