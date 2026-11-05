import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { productType } from './enums.js';
import { pk, softDelete, timestamps, tstz } from './_helpers.js';
import { productSearchExpr, trgmIndex } from './_search.js';
import { users } from './system.js';

/** Nhóm hàng dạng cây (hiện tối đa 2 cấp, hỗ trợ nhiều cấp). */
export const categories = pgTable(
  'categories',
  {
    id: pk(),
    name: text().notNull(),
    parentId: uuid().references((): AnyPgColumn => categories.id),
    sortOrder: integer().notNull().default(0),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index('categories_parent_idx').on(t.parentId),
    // Tên không trùng trong cùng nhóm cha (không phân biệt hoa thường và dấu); nhóm gốc dùng UUID rỗng thay NULL
    uniqueIndex('categories_sibling_name_unique')
      .on(
        sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`f_search_text(${t.name})`,
      )
      .where(sql`${t.deletedAt} is null`),
  ],
);

/**
 * Hàng hóa. Mỗi quy cách là một SKU riêng (đơn vị nằm trong tên), không có biến thể/lô.
 * `product_type`: `goods` (Hàng hóa) hoặc `combo` (gói các hàng thành phần ở `product_components`; KHÔNG có dòng tồn
 * riêng — tồn, giá vốn của combo luôn tính từ thành phần). Chỉ chứa thông tin DÙNG CHUNG giữa các chi nhánh. Không có giá bán trong hệ thống (giá quy ước chung ở mô tả hàng);
 * tồn kho, giá vốn bình quân, giá nhập cuối, tồn tối thiểu/tối đa và vị trí kho nằm ở `stocks` (theo chi nhánh).
 */
export const products = pgTable(
  'products',
  {
    id: pk(),
    code: text().notNull().unique(),
    name: text().notNull(),
    categoryId: uuid().references(() => categories.id),
    productType: productType().notNull().default('goods'),
    description: text(),
    isActive: boolean().notNull().default(true),
    createdBy: uuid().references(() => users.id),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index('products_category_idx').on(t.categoryId),
    trgmIndex('products_search_trgm', productSearchExpr(t)),
    index('products_active_idx').on(t.isActive),
    index('products_type_idx').on(t.productType),
    // Mã hàng không trùng kể cả khác hoa thường (cột `code` đã có ràng buộc duy nhất phân biệt hoa thường)
    uniqueIndex('products_code_lower_unique').on(sql`lower(${t.code})`),
  ],
);

/**
 * Thành phần của combo: một combo gồm nhiều hàng hóa (loại `goods`), mỗi hàng một số lượng nguyên dương.
 * Chuỗi hiển thị/nhập Excel: `MSP/SL,MSP/SL`.
 */
export const productComponents = pgTable(
  'product_components',
  {
    comboId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    componentId: uuid()
      .notNull()
      .references(() => products.id),
    qty: integer().notNull(),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.comboId, t.componentId] }),
    index('product_components_component_idx').on(t.componentId),
    check('product_components_qty_positive', sql`${t.qty} > 0`),
    check('product_components_not_self', sql`${t.comboId} <> ${t.componentId}`),
  ],
);

export const productImages = pgTable(
  'product_images',
  {
    id: pk(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    url: text().notNull(),
    storageKey: text(),
    sortOrder: integer().notNull().default(0),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [index('product_images_product_idx').on(t.productId)],
);
