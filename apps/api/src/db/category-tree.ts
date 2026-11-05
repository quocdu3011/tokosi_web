import { isNull } from 'drizzle-orm';
import type { DbOrTx } from './database.module.js';
import { categories } from './schema/index.js';

/** Nhóm hàng này và mọi nhóm con, cháu (chưa xóa). Dùng để lọc hàng theo nhóm gồm cả nhóm con. */
export async function categoryWithDescendants(
  db: DbOrTx,
  rootId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories)
    .where(isNull(categories.deletedAt));
  const result = [rootId];
  for (let i = 0; i < result.length; i++) {
    for (const r of rows) {
      if (r.parentId === result[i]) result.push(r.id);
    }
  }
  return result;
}
