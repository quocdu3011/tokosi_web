import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { normalizeHeader, type ParsedSheet } from '../../common/excel.js';
import type { Tx } from '../../db/database.module.js';
import {
  categories,
  priceBookItems,
  priceBooks,
  productImages,
  products,
  stocks,
} from '../../db/schema/index.js';
import { PRODUCT_CODE_PATTERN } from '../catalog/products.dto.js';
import {
  asFlag,
  asNonNegDecimal,
  asNonNegInt,
  asText,
  chunk,
  hasColumn,
  pgArrayLiteral,
  pick,
  type ImportOutcome,
  type ImportRowError,
} from './import-cells.js';

/** Tên cột (đã chuẩn hóa) mà bộ nhập nhận ra; nhận cả tiêu đề file KiotViet lẫn file mẫu của hệ thống. */
const COL = {
  code: ['ma hang'],
  name: ['ten hang'],
  unit: ['don vi tinh', 'dvt'],
  category: ['nhom hang(3 cap)', 'nhom hang'],
  price: ['gia ban'],
  active: ['dang kinh doanh'],
  sellable: ['duoc ban truc tiep'],
  weight: ['trong luong'],
  description: ['mo ta'],
  location: ['vi tri'],
  min: ['ton nho nhat'],
  max: ['ton lon nhat'],
} as const;
/** Cột ảnh: KiotViet đặt tên "Hình ảnh (url1,url2...)". */
const imageHeader = (headers: string[]) =>
  headers.find((h) => h.startsWith('hinh anh'));

const MAX_IMAGES = 10;
const BATCH = 500;

interface ParsedRow {
  row: number;
  code: string;
  name: string;
  unit?: string;
  categoryPath?: string[];
  price?: number; // chỉ khi có giá (> 0)
  active?: boolean;
  sellable?: boolean;
  weight?: string | null;
  description?: string;
  location?: string;
  min?: string;
  max?: string;
  images: string[];
}

export interface ProductImportOptions {
  /** Chi nhánh cho giá bán, tồn tối thiểu/tối đa, vị trí. Bắt buộc nếu file có các cột đó. */
  branchId?: string;
  userId: string;
}

/**
 * Nhập hàng hóa từ Excel (cột theo file KiotViet). Cập nhật theo MÃ HÀNG (không phân biệt hoa thường), chạy lại
 * cùng file không tạo trùng. KHÔNG nhập `Tồn kho` và `Giá vốn`: số dư đầu kỳ do công cụ chuyển dữ liệu riêng xử lý.
 *
 * Kiểm tra toàn bộ file trước; có bất kỳ dòng lỗi nào thì KHÔNG ghi gì. Phải chạy trong transaction của người gọi.
 */
export async function importProducts(
  tx: Tx,
  sheet: ParsedSheet,
  opts: ProductImportOptions,
): Promise<ImportOutcome> {
  const errors: ImportRowError[] = [];
  const headers = sheet.headers;
  for (const [field, aliases] of [
    ['Mã hàng', COL.code],
    ['Tên hàng', COL.name],
  ] as const) {
    if (!hasColumn(headers, aliases)) {
      errors.push({ row: 1, field, message: `Thiếu cột bắt buộc "${field}"` });
    }
  }
  const hasPrice = hasColumn(headers, COL.price);
  const hasStockCols =
    hasColumn(headers, COL.location) ||
    hasColumn(headers, COL.min) ||
    hasColumn(headers, COL.max);
  if ((hasPrice || hasStockCols) && !opts.branchId) {
    errors.push({
      row: 1,
      field: 'branchId',
      message:
        'File có cột giá bán / tồn tối thiểu / tồn tối đa / vị trí nên cần chọn chi nhánh (branchId)',
    });
  }
  if (errors.length > 0) return { created: 0, updated: 0, errors };

  // ---------- 1) đọc và kiểm tra từng dòng
  const parsed: ParsedRow[] = [];
  const seen = new Map<string, number>();
  const imgHeader = imageHeader(headers);
  for (const { row, values } of sheet.rows) {
    const err = (field: string, message: string) =>
      errors.push({ row, field, message });

    const code = asText(pick(values, COL.code));
    const name = asText(pick(values, COL.name));
    if (!code) err('Mã hàng', 'Thiếu mã hàng');
    else if (!PRODUCT_CODE_PATTERN.test(code))
      err(
        'Mã hàng',
        'Mã hàng chỉ gồm chữ, số, "-", "_", "." và dài 1-30 ký tự',
      );
    if (!name) err('Tên hàng', 'Thiếu tên hàng');
    else if (name.length > 255) err('Tên hàng', 'Tên hàng dài quá 255 ký tự');
    if (code) {
      const key = code.toLowerCase();
      const first = seen.get(key);
      if (first !== undefined)
        err('Mã hàng', `Mã hàng trùng với dòng ${first} trong file`);
      else seen.set(key, row);
    }

    const unit = asText(pick(values, COL.unit));
    if (unit && unit.length > 30)
      err('Đơn vị tính', 'Đơn vị tính dài quá 30 ký tự');

    let categoryPath: string[] | undefined;
    const categoryRaw = asText(pick(values, COL.category));
    if (categoryRaw) {
      categoryPath = categoryRaw.split('>>').map((p) => p.trim());
      if (
        categoryPath.some((p) => p === '' || p.length > 100) ||
        categoryPath.length > 3
      ) {
        err(
          'Nhóm hàng',
          'Nhóm hàng tối đa 3 cấp, ngăn cách bằng ">>", mỗi cấp 1-100 ký tự',
        );
        categoryPath = undefined;
      }
    }

    let price: number | undefined;
    const priceRaw = asNonNegInt(pick(values, COL.price));
    if (priceRaw === undefined)
      err('Giá bán', 'Giá bán phải là số nguyên đồng, không âm');
    else if (priceRaw !== null && priceRaw > 0) price = priceRaw; // 0 hoặc trống = chưa có giá

    const active = asFlag(pick(values, COL.active));
    if (active === undefined) err('Đang kinh doanh', 'Chỉ nhận 1/0');
    const sellable = asFlag(pick(values, COL.sellable));
    if (sellable === undefined) err('Được bán trực tiếp', 'Chỉ nhận 1/0');

    let weight: string | null | undefined;
    if (hasColumn(headers, COL.weight)) {
      const w = asNonNegDecimal(pick(values, COL.weight), 2);
      if (w === undefined) err('Trọng lượng', 'Trọng lượng không hợp lệ');
      else weight = w === null || Number(w) === 0 ? null : w;
    }

    const min = asNonNegDecimal(pick(values, COL.min), 3);
    if (min === undefined) err('Tồn nhỏ nhất', 'Số lượng không hợp lệ');
    const max = asNonNegDecimal(pick(values, COL.max), 3);
    if (max === undefined) err('Tồn lớn nhất', 'Số lượng không hợp lệ');
    if (min && max && Number(min) > Number(max))
      err('Tồn nhỏ nhất', 'Tồn nhỏ nhất không được lớn hơn tồn lớn nhất');

    const images: string[] = [];
    const imagesRaw = imgHeader ? asText(values[imgHeader]) : null;
    if (imagesRaw) {
      for (const u of imagesRaw
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)) {
        if (!/^https?:\/\/\S+$/i.test(u) || u.length > 2000) {
          err('Hình ảnh', `Địa chỉ ảnh không hợp lệ: ${u.slice(0, 60)}`);
        } else if (!images.includes(u)) images.push(u);
      }
      if (images.length > MAX_IMAGES)
        err('Hình ảnh', `Tối đa ${MAX_IMAGES} ảnh mỗi hàng`);
    }

    if (code && name) {
      parsed.push({
        row,
        code,
        name,
        unit: unit ?? undefined,
        categoryPath,
        price,
        active: active ?? undefined,
        sellable: sellable ?? undefined,
        weight,
        description: asText(pick(values, COL.description)) ?? undefined,
        location: asText(pick(values, COL.location)) ?? undefined,
        min: min ?? undefined,
        max: max ?? undefined,
        images,
      });
    }
  }
  if (errors.length > 0) return { created: 0, updated: 0, errors };

  // ---------- 2) nhóm hàng: tạo các nhóm còn thiếu
  const categoryIds = new Map<string, string>(); // khóa = đường dẫn đã chuẩn hóa
  for (const r of parsed) {
    if (!r.categoryPath) continue;
    let parentId: string | null = null;
    let key = '';
    for (const part of r.categoryPath) {
      key += `>>${normalizeHeader(part)}`;
      let id = categoryIds.get(key);
      if (!id) {
        id = await findOrCreateCategory(tx, parentId, part);
        categoryIds.set(key, id);
      }
      parentId = id;
    }
  }
  const categoryOf = (path: string[] | undefined): string | undefined => {
    if (!path) return undefined;
    return categoryIds.get(path.map((p) => `>>${normalizeHeader(p)}`).join(''));
  };

  // ---------- 3) hàng hiện có theo mã (không phân biệt hoa thường)
  const existing = new Map<string, typeof products.$inferSelect>();
  for (const part of chunk(
    parsed.map((r) => r.code.toLowerCase()),
    1000,
  )) {
    const rows = await tx
      .select()
      .from(products)
      .where(
        sql`lower(${products.code}) = any(${pgArrayLiteral(part)}::text[])`,
      );
    for (const p of rows) existing.set(p.code.toLowerCase(), p);
  }
  for (const r of parsed) {
    const p = existing.get(r.code.toLowerCase());
    if (p?.deletedAt) {
      errors.push({
        row: r.row,
        field: 'Mã hàng',
        message: 'Mã hàng thuộc một hàng đã bị xóa',
      });
    }
  }
  if (errors.length > 0) return { created: 0, updated: 0, errors };

  // ---------- 4) tạo hàng mới, sửa hàng cũ (chỉ ghi khi có thay đổi)
  let created = 0;
  const changed = new Set<string>(); // mã (chữ thường) của hàng có thay đổi
  const idByCode = new Map<string, string>(); // mọi hàng trong file (cũ và mới) → id
  for (const [code, p] of existing) idByCode.set(code, p.id);
  const toInsert = parsed.filter((r) => !existing.has(r.code.toLowerCase()));
  for (const part of chunk(toInsert, BATCH)) {
    const inserted = await tx
      .insert(products)
      .values(
        part.map((r) => ({
          code: r.code,
          name: r.name,
          unit: r.unit ?? 'Cái',
          categoryId: categoryOf(r.categoryPath) ?? null,
          description: r.description ?? null,
          weightG: r.weight ?? null,
          isActive: r.active ?? true,
          isSellable: r.sellable ?? true,
          createdBy: opts.userId,
        })),
      )
      .returning({ id: products.id, code: products.code });
    for (const p of inserted) idByCode.set(p.code.toLowerCase(), p.id);
    created += inserted.length;
  }
  const idOf = (code: string) => idByCode.get(code.toLowerCase())!;

  for (const r of parsed) {
    const cur = existing.get(r.code.toLowerCase());
    if (!cur) continue; // hàng vừa tạo ở trên
    const patch: Partial<typeof products.$inferInsert> = {};
    if (cur.name !== r.name) patch.name = r.name;
    if (r.unit !== undefined && cur.unit !== r.unit) patch.unit = r.unit;
    const cat = categoryOf(r.categoryPath);
    if (cat !== undefined && cur.categoryId !== cat) patch.categoryId = cat;
    if (r.description !== undefined && cur.description !== r.description)
      patch.description = r.description;
    if (
      r.weight !== undefined &&
      Number(cur.weightG ?? 0) !== Number(r.weight ?? 0)
    )
      patch.weightG = r.weight;
    if (r.active !== undefined && cur.isActive !== r.active)
      patch.isActive = r.active;
    if (r.sellable !== undefined && cur.isSellable !== r.sellable)
      patch.isSellable = r.sellable;
    if (Object.keys(patch).length > 0) {
      await tx
        .update(products)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(products.id, cur.id));
      changed.add(r.code.toLowerCase());
    }
  }

  // ---------- 5) giá bán (Bảng giá chung của chi nhánh) — luôn theo thứ tự id để không bế tắc
  if (opts.branchId && hasPrice) {
    const [book] = await tx
      .select({ id: priceBooks.id })
      .from(priceBooks)
      .where(eq(priceBooks.isDefault, true));
    const rows = parsed
      .filter((r) => r.price !== undefined)
      .map((r) => ({
        code: r.code.toLowerCase(),
        productId: idOf(r.code),
        price: r.price!,
      }))
      .sort((a, b) => a.productId.localeCompare(b.productId));
    const old = new Map<string, number>();
    for (const part of chunk(rows, 1000)) {
      const found = await tx
        .select()
        .from(priceBookItems)
        .where(
          and(
            eq(priceBookItems.priceBookId, book!.id),
            eq(priceBookItems.branchId, opts.branchId),
            inArray(
              priceBookItems.productId,
              part.map((x) => x.productId),
            ),
          ),
        );
      for (const f of found) old.set(f.productId, Number(f.price));
    }
    const diff = rows.filter((x) => old.get(x.productId) !== x.price);
    for (const part of chunk(diff, BATCH)) {
      await tx
        .insert(priceBookItems)
        .values(
          part.map((x) => ({
            priceBookId: book!.id,
            branchId: opts.branchId!,
            productId: x.productId,
            price: String(x.price),
            updatedBy: opts.userId,
          })),
        )
        .onConflictDoUpdate({
          target: [
            priceBookItems.priceBookId,
            priceBookItems.branchId,
            priceBookItems.productId,
          ],
          set: {
            price: sql`excluded.price`,
            updatedBy: opts.userId,
            updatedAt: new Date(),
          },
        });
    }
    for (const x of diff) changed.add(x.code);
  }

  // ---------- 6) tồn tối thiểu / tối đa / vị trí (ô trống = không đổi)
  if (opts.branchId && hasStockCols) {
    const rows = parsed
      .filter(
        (r) =>
          r.min !== undefined ||
          r.max !== undefined ||
          r.location !== undefined,
      )
      .map((r) => ({ r, productId: idOf(r.code) }))
      .sort((a, b) => a.productId.localeCompare(b.productId));
    const old = new Map<string, typeof stocks.$inferSelect>();
    for (const part of chunk(rows, 1000)) {
      const found = await tx
        .select()
        .from(stocks)
        .where(
          and(
            eq(stocks.branchId, opts.branchId),
            inArray(
              stocks.productId,
              part.map((x) => x.productId),
            ),
          ),
        );
      for (const f of found) old.set(f.productId, f);
    }
    const diff = rows.filter(({ r, productId }) => {
      const o = old.get(productId);
      return (
        (r.min !== undefined && Number(o?.minStock ?? NaN) !== Number(r.min)) ||
        (r.max !== undefined && Number(o?.maxStock ?? NaN) !== Number(r.max)) ||
        (r.location !== undefined && (o?.location ?? null) !== r.location)
      );
    });
    for (const part of chunk(diff, BATCH)) {
      await tx
        .insert(stocks)
        .values(
          part.map(({ r, productId }) => ({
            branchId: opts.branchId!,
            productId,
            minStock: r.min ?? null,
            maxStock: r.max ?? null,
            location: r.location ?? null,
          })),
        )
        .onConflictDoUpdate({
          target: [stocks.branchId, stocks.productId],
          set: {
            minStock: sql`coalesce(excluded.min_stock, ${stocks.minStock})`,
            maxStock: sql`coalesce(excluded.max_stock, ${stocks.maxStock})`,
            location: sql`coalesce(excluded.location, ${stocks.location})`,
            updatedAt: new Date(),
          },
        });
    }
    for (const { r } of diff) changed.add(r.code.toLowerCase());
  }

  // ---------- 7) ảnh: thêm URL ngoài chưa có (storage_key = null), không xóa ảnh hiện có
  const withImages = parsed.filter((r) => r.images.length > 0);
  if (withImages.length > 0) {
    const ids = withImages.map((r) => idOf(r.code));
    const have = new Map<string, Array<{ url: string; sortOrder: number }>>();
    for (const part of chunk(ids, 1000)) {
      const found = await tx
        .select()
        .from(productImages)
        .where(inArray(productImages.productId, part));
      for (const f of found) {
        const list = have.get(f.productId) ?? [];
        list.push({ url: f.url, sortOrder: f.sortOrder });
        have.set(f.productId, list);
      }
    }
    const rows: Array<typeof productImages.$inferInsert> = [];
    for (const r of withImages) {
      const productId = idOf(r.code);
      const cur = have.get(productId) ?? [];
      let next = Math.max(-1, ...cur.map((c) => c.sortOrder)) + 1;
      for (const url of r.images) {
        if (cur.some((c) => c.url === url) || cur.length + 1 > MAX_IMAGES)
          continue;
        cur.push({ url, sortOrder: next });
        rows.push({ productId, url, storageKey: null, sortOrder: next++ });
        changed.add(r.code.toLowerCase());
      }
    }
    for (const part of chunk(rows, BATCH))
      await tx.insert(productImages).values(part);
  }

  const createdCodes = new Set(toInsert.map((r) => r.code.toLowerCase()));
  const updated = [...changed].filter((c) => !createdCodes.has(c)).length;
  return { created, updated, errors: [] };
}

async function findOrCreateCategory(
  tx: Tx,
  parentId: string | null,
  name: string,
): Promise<string> {
  const [found] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        isNull(categories.deletedAt),
        parentId
          ? eq(categories.parentId, parentId)
          : isNull(categories.parentId),
        sql`f_search_text(${categories.name}) = f_search_text(${name})`,
      ),
    );
  if (found) return found.id;
  const [last] = await tx
    .select({ max: sql<number>`coalesce(max(${categories.sortOrder}), 0)` })
    .from(categories)
    .where(
      and(
        isNull(categories.deletedAt),
        parentId
          ? eq(categories.parentId, parentId)
          : isNull(categories.parentId),
      ),
    );
  const [row] = await tx
    .insert(categories)
    .values({ name, parentId, sortOrder: (last?.max ?? 0) + 1 })
    .returning({ id: categories.id });
  return row!.id;
}
