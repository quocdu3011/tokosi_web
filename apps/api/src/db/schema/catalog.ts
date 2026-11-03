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
import {
  pk,
  price,
  quantity,
  softDelete,
  timestamps,
  tstz,
} from './_helpers.js';
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
  (t) => [index('categories_parent_idx').on(t.parentId)],
);

/**
 * Hàng hóa. Mỗi quy cách là một SKU riêng (đơn vị nằm trong tên), không có biến thể/combo/lô.
 * `costPrice` = giá vốn bình quân gia quyền; tồn kho ở bảng `stocks` (không lưu ở đây).
 */
export const products = pgTable(
  'products',
  {
    id: pk(),
    code: text().notNull().unique(),
    name: text().notNull(),
    categoryId: uuid().references(() => categories.id),
    unit: text().notNull().default('Cái'),
    basePrice: price().notNull().default('0'),
    costPrice: price().notNull().default('0'),
    lastPurchasePrice: price(),
    minStock: quantity(),
    maxStock: quantity(),
    location: text(),
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

export const priceBookItems = pgTable(
  'price_book_items',
  {
    priceBookId: uuid()
      .notNull()
      .references(() => priceBooks.id, { onDelete: 'cascade' }),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    price: price().notNull(),
    updatedBy: uuid().references(() => users.id),
    updatedAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.priceBookId, t.productId] }),
    index('price_book_items_product_idx').on(t.productId),
  ],
);
