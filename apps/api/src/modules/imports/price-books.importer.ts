import { and, eq, inArray, sql } from 'drizzle-orm';
import { normalizeHeader, type ParsedSheet } from '../../common/excel.js';
import type { Tx } from '../../db/database.module.js';
import { priceBookItems, priceBooks, products } from '../../db/schema/index.js';
import {
  asNonNegInt,
  chunk,
  hasColumn,
  pgArrayLiteral,
  type ImportOutcome,
  type ImportRowError,
} from './import-cells.js';

const CODE_COLUMN = ['ma hang'] as const;
const BATCH = 500;

export interface PriceBookImportOptions {
  /** Chi nhánh được nhập giá (bắt buộc: giá là riêng từng chi nhánh). */
  branchId?: string;
  userId: string;
}

/**
 * Nhập giá bán từ Excel: cột `Mã hàng` + mỗi cột một bảng giá (tiêu đề là TÊN hoặc MÃ bảng giá, vd "Bảng giá chung",
 * "Lớn", "LON_VAT"). Cột khác (tên hàng, tồn kho, giá vốn…) bị bỏ qua. Ô trống hoặc 0 = giữ nguyên (không xóa giá).
 * Giá là số nguyên đồng. Kiểm tra cả file trước; có lỗi thì KHÔNG ghi gì. Chạy trong transaction của người gọi.
 *
 * `created` = số ô giá mới, `updated` = số ô đổi giá.
 */
export async function importPriceBooks(
  tx: Tx,
  sheet: ParsedSheet,
  opts: PriceBookImportOptions,
): Promise<ImportOutcome> {
  const errors: ImportRowError[] = [];
  if (!hasColumn(sheet.headers, CODE_COLUMN)) {
    errors.push({
      row: 1,
      field: 'Mã hàng',
      message: 'Thiếu cột bắt buộc "Mã hàng"',
    });
  }
  if (!opts.branchId) {
    errors.push({
      row: 1,
      field: 'branchId',
      message: 'Cần chọn chi nhánh (branchId): giá bán là riêng từng chi nhánh',
    });
  }
  const books = await tx.select().from(priceBooks);
  const bookByHeader = new Map<string, string>();
  for (const b of books) {
    bookByHeader.set(normalizeHeader(b.name), b.id);
    bookByHeader.set(normalizeHeader(b.code), b.id);
  }
  const priceColumns = sheet.headers
    .map((h) => ({ header: h, bookId: bookByHeader.get(h) }))
    .filter(
      (c): c is { header: string; bookId: string } => c.bookId !== undefined,
    );
  if (priceColumns.length === 0) {
    errors.push({
      row: 1,
      field: 'Bảng giá',
      message:
        'Không có cột nào trùng tên hoặc mã một bảng giá (vd "Bảng giá chung", "Lớn", "LON_VAT")',
    });
  }
  if (errors.length > 0) return { created: 0, updated: 0, errors };

  // sản phẩm theo mã (không phân biệt hoa thường)
  const codes = sheet.rows
    .map((r) => String(r.values['ma hang'] ?? '').trim())
    .filter(Boolean);
  const idByCode = new Map<string, string>();
  for (const part of chunk(
    codes.map((c) => c.toLowerCase()),
    1000,
  )) {
    const found = await tx
      .select({ id: products.id, code: products.code })
      .from(products)
      .where(
        sql`lower(${products.code}) = any(${pgArrayLiteral(part)}::text[])`,
      );
    for (const p of found) idByCode.set(p.code.toLowerCase(), p.id);
  }

  const wanted: Array<{ productId: string; bookId: string; price: number }> =
    [];
  const seen = new Map<string, number>();
  for (const { row, values } of sheet.rows) {
    const code = String(values['ma hang'] ?? '').trim();
    if (!code) {
      errors.push({ row, field: 'Mã hàng', message: 'Thiếu mã hàng' });
      continue;
    }
    const first = seen.get(code.toLowerCase());
    if (first !== undefined) {
      errors.push({
        row,
        field: 'Mã hàng',
        message: `Mã hàng trùng với dòng ${first} trong file`,
      });
      continue;
    }
    seen.set(code.toLowerCase(), row);
    const productId = idByCode.get(code.toLowerCase());
    if (!productId) {
      errors.push({
        row,
        field: 'Mã hàng',
        message: `Mã hàng "${code}" không tồn tại`,
      });
      continue;
    }
    for (const col of priceColumns) {
      const price = asNonNegInt(values[col.header]);
      if (price === undefined) {
        errors.push({
          row,
          field: col.header,
          message: 'Giá bán phải là số nguyên đồng, không âm',
        });
      } else if (price !== null && price > 0) {
        wanted.push({ productId, bookId: col.bookId, price });
      }
    }
  }
  if (errors.length > 0) return { created: 0, updated: 0, errors };

  // giá hiện có của các ô này
  const old = new Map<string, number>(); // `${bookId}|${productId}`
  for (const part of chunk(
    [...new Set(wanted.map((w) => w.productId))],
    1000,
  )) {
    const found = await tx
      .select()
      .from(priceBookItems)
      .where(
        and(
          eq(priceBookItems.branchId, opts.branchId!),
          inArray(priceBookItems.productId, part),
        ),
      );
    for (const f of found)
      old.set(`${f.priceBookId}|${f.productId}`, Number(f.price));
  }
  // theo thứ tự (bảng giá, sản phẩm) để hai lần nhập/lưu lưới cùng lúc không bế tắc
  const diff = wanted
    .filter((w) => old.get(`${w.bookId}|${w.productId}`) !== w.price)
    .sort(
      (a, b) =>
        a.bookId.localeCompare(b.bookId) ||
        a.productId.localeCompare(b.productId),
    );
  let created = 0;
  let updated = 0;
  for (const w of diff) {
    if (old.has(`${w.bookId}|${w.productId}`)) updated++;
    else created++;
  }
  for (const part of chunk(diff, BATCH)) {
    await tx
      .insert(priceBookItems)
      .values(
        part.map((w) => ({
          priceBookId: w.bookId,
          branchId: opts.branchId!,
          productId: w.productId,
          price: String(w.price),
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
  return { created, updated, errors: [] };
}
