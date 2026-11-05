import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { pk, price, softDelete, timestamps, tstz } from './_helpers.js';
import { productSearchExpr, trgmIndex } from './_search.js';
import { branches, users } from './system.js';

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
 * Hàng hóa. Mỗi quy cách là một SKU riêng (đơn vị nằm trong tên), không có biến thể/combo/lô.
 * Chỉ chứa thông tin DÙNG CHUNG giữa các chi nhánh. Giá bán nằm ở `price_book_items` (theo chi nhánh);
 * tồn kho, giá vốn bình quân, giá nhập cuối, tồn tối thiểu/tối đa và vị trí kho nằm ở `stocks` (theo chi nhánh).
 */
export const products = pgTable(
  'products',
  {
    id: pk(),
    code: text().notNull().unique(),
    name: text().notNull(),
    categoryId: uuid().references(() => categories.id),
    unit: text().notNull().default('Cái'),
    description: text(),
    weightG: numeric({ precision: 12, scale: 2 }),
    isActive: boolean().notNull().default(true),
    isSellable: boolean().notNull().default(true),
    createdBy: uuid().references(() => users.id),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index('products_category_idx').on(t.categoryId),
    trgmIndex('products_search_trgm', productSearchExpr(t)),
    index('products_active_idx').on(t.isActive),
    // Mã hàng không trùng kể cả khác hoa thường (cột `code` đã có ràng buộc duy nhất phân biệt hoa thường)
    uniqueIndex('products_code_lower_unique').on(sql`lower(${t.code})`),
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

/**
 * Bảng giá theo hạng khách: Chung (mặc định), Lớn, Vừa, VIP và 3 bản VAT.
 * Sản phẩm thiếu giá ở một bảng thì lùi về bảng mặc định.
 */
export const priceBooks = pgTable(
  'price_books',
  {
    id: pk(),
    code: text().notNull().unique(),
    name: text().notNull(),
    withVat: boolean().notNull().default(false),
    isDefault: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('price_books_one_default')
      .on(t.isDefault)
      .where(sql`${t.isDefault}`),
  ],
);

/** Giá bán của từng sản phẩm, trong từng bảng giá, TẠI TỪNG CHI NHÁNH. */
export const priceBookItems = pgTable(
  'price_book_items',
  {
    priceBookId: uuid()
      .notNull()
      .references(() => priceBooks.id, { onDelete: 'cascade' }),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    price: price().notNull(),
    updatedBy: uuid().references(() => users.id),
    updatedAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.priceBookId, t.branchId, t.productId] }),
    index('price_book_items_branch_product_idx').on(t.branchId, t.productId),
  ],
);
