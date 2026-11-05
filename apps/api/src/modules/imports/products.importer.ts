import {
  LIQUIDATION_STATUSES,
  LIQUIDATION_STATUS_LABELS,
  parseComponents,
  type LiquidationStatus,
  type ProductType,
} from '@kiot/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { normalizeHeader, type ParsedSheet } from '../../common/excel.js';
import type { Tx } from '../../db/database.module.js';
import {
  categories,
  productComponents,
  productImages,
  products,
} from '../../db/schema/index.js';
import { loadComponents } from '../catalog/combo.js';
import { PRODUCT_CODE_PATTERN } from '../catalog/products.dto.js';
import {
  asFlag,
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
  type: ['loai hang'],
  components: ['hang thanh phan'],
  category: ['nhom hang(3 cap)', 'nhom hang'],
  active: ['dang kinh doanh'],
  description: ['mo ta'],
  liquidation: ['trang thai thanh ly'],
} as const;
/** Cột ảnh: KiotViet đặt tên "Hình ảnh (url1,url2...)". */
const imageHeader = (headers: string[]) =>
  headers.find((h) => h.startsWith('hinh anh'));

/** Nhãn (đã chuẩn hóa không dấu) hoặc mã → trạng thái thanh lý. */
const LIQUIDATION_BY_TEXT = new Map<string, LiquidationStatus>(
  LIQUIDATION_STATUSES.flatMap((st) => [
    [normalizeHeader(LIQUIDATION_STATUS_LABELS[st]), st] as const,
    [st, st] as const,
  ]),
);

const MAX_IMAGES = 10;
const BATCH = 500;

interface ParsedRow {
  row: number;
  code: string;
  name: string;
  type?: ProductType;
  components?: Array<{ code: string; qty: number }>;
  categoryPath?: string[];
  active?: boolean;
  description?: string;
  liquidation?: LiquidationStatus;
  images: string[];
}

export interface ProductImportOptions {
  /** Chi nhánh cho tồn tối thiểu/tối đa, vị trí. Bắt buộc nếu file có các cột đó. */
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

    // Loại hàng: "Hàng hóa" | "Combo" (KiotViet ghi "Combo - Đóng gói"); trống = suy ra từ cột Hàng thành phần
    let type: ProductType | undefined;
    const typeRaw = asText(pick(values, COL.type));
    if (typeRaw) {
      const t = normalizeHeader(typeRaw);
      if (t.startsWith('combo')) type = 'combo';
      else if (t === 'hang hoa') type = 'goods';
      else err('Loại hàng', 'Chỉ nhận "Hàng hóa" hoặc "Combo"');
    }
    let components: Array<{ code: string; qty: number }> | undefined;
    const compRaw = asText(pick(values, COL.components));
    if (compRaw) {
      const c = parseComponents(compRaw);
      if (!c.ok) err('Hàng thành phần', c.error);
      else {
        components = c.items;
        if (type === undefined) type = 'combo';
        else if (type === 'goods')
          err('Hàng thành phần', 'Hàng hóa không có hàng thành phần');
      }
    }
    if (type === 'combo' && !components && !compRaw)
      err('Hàng thành phần', 'Combo phải có ít nhất một hàng thành phần');

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

    const active = asFlag(pick(values, COL.active));
    if (active === undefined) err('Đang kinh doanh', 'Chỉ nhận 1/0');

    let liquidation: LiquidationStatus | undefined;
    const liqRaw = asText(pick(values, COL.liquidation));
    if (liqRaw) {
      liquidation = LIQUIDATION_BY_TEXT.get(normalizeHeader(liqRaw));
      if (!liquidation)
        err(
          'Trạng thái thanh lý',
          'Chỉ nhận: Thường, Thanh Lý, Tắt Mã, Tồn Cao, Tồn Ưu Tiên',
        );
    }

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
        type,
        components,
        categoryPath,
        active: active ?? undefined,
        description: asText(pick(values, COL.description)) ?? undefined,
        liquidation,
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
  // Loại hàng của hàng đã có không đổi qua Excel (đổi trên giao diện, có kiểm tra giao dịch)
  const typeOfRow = new Map<string, ProductType>(); // loại hàng sau khi nhập, theo mã (chữ thường)
  for (const r of parsed) {
    const cur = existing.get(r.code.toLowerCase());
    if (cur && r.type !== undefined && r.type !== cur.productType) {
      errors.push({
        row: r.row,
        field: 'Loại hàng',
        message:
          'Không đổi được loại hàng bằng nhập Excel; hãy sửa trực tiếp trên hàng hóa đó',
      });
    }
    typeOfRow.set(r.code.toLowerCase(), r.type ?? cur?.productType ?? 'goods');
  }
  // Hàng thành phần phải là hàng hóa đã có (trong file hoặc CSDL), không phải combo
  const outsideCodes = new Set<string>();
  for (const r of parsed)
    for (const c of r.components ?? [])
      if (!typeOfRow.has(c.code.toLowerCase()))
        outsideCodes.add(c.code.toLowerCase());
  const outsideType = new Map<string, ProductType>();
  for (const part of chunk([...outsideCodes], 1000)) {
    const rows = await tx
      .select({ code: products.code, productType: products.productType })
      .from(products)
      .where(
        and(
          isNull(products.deletedAt),
          sql`lower(${products.code}) = any(${pgArrayLiteral(part)}::text[])`,
        ),
      );
    for (const x of rows) outsideType.set(x.code.toLowerCase(), x.productType);
  }
  for (const r of parsed) {
    for (const c of r.components ?? []) {
      const key = c.code.toLowerCase();
      const t = typeOfRow.get(key) ?? outsideType.get(key);
      const problem =
        t === undefined
          ? `Không tìm thấy hàng thành phần "${c.code}"`
          : t === 'combo'
            ? `Thành phần "${c.code}" là combo; thành phần phải là hàng hóa`
            : null;
      if (problem)
        errors.push({ row: r.row, field: 'Hàng thành phần', message: problem });
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
          productType: r.type ?? ('goods' as const),
          categoryId: categoryOf(r.categoryPath) ?? null,
          description: r.description ?? null,
          isActive: r.active ?? true,
          liquidationStatus: r.liquidation ?? ('normal' as const),
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
    const cat = categoryOf(r.categoryPath);
    if (cat !== undefined && cur.categoryId !== cat) patch.categoryId = cat;
    if (r.description !== undefined && cur.description !== r.description)
      patch.description = r.description;
    if (r.active !== undefined && cur.isActive !== r.active)
      patch.isActive = r.active;
    if (r.liquidation !== undefined && cur.liquidationStatus !== r.liquidation)
      patch.liquidationStatus = r.liquidation;
    if (Object.keys(patch).length > 0) {
      await tx
        .update(products)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(products.id, cur.id));
      changed.add(r.code.toLowerCase());
    }
  }

  // ---------- 4b) hàng thành phần của combo (thay khi khác bản hiện có)
  const comboRows = parsed.filter((r) => r.components);
  if (comboRows.length > 0) {
    const current = await loadComponents(
      tx,
      comboRows.map((r) => idOf(r.code)),
    );
    const comboIdByCode = new Map<string, string>();
    for (const part of chunk(
      [
        ...new Set(
          comboRows.flatMap((r) =>
            r.components!.map((c) => c.code.toLowerCase()),
          ),
        ),
      ],
      1000,
    )) {
      const found = await tx
        .select({ id: products.id, code: products.code })
        .from(products)
        .where(
          sql`lower(${products.code}) = any(${pgArrayLiteral(part)}::text[])`,
        );
      for (const f of found) comboIdByCode.set(f.code.toLowerCase(), f.id);
    }
    for (const r of comboRows) {
      const comboId = idOf(r.code);
      const want = r.components!.map((c) => ({
        productId: comboIdByCode.get(c.code.toLowerCase())!,
        qty: c.qty,
      }));
      const have = (current.get(comboId) ?? []).map((c) => ({
        productId: c.productId,
        qty: c.qty,
      }));
      const same =
        want.length === have.length &&
        want.every(
          (w, i) =>
            have[i]!.productId === w.productId && have[i]!.qty === w.qty,
        );
      if (same) continue;
      await tx
        .delete(productComponents)
        .where(eq(productComponents.comboId, comboId));
      await tx.insert(productComponents).values(
        want.map((w, i) => ({
          comboId,
          componentId: w.productId,
          qty: w.qty,
          sortOrder: i,
        })),
      );
      changed.add(r.code.toLowerCase());
    }
  }

  // ---------- 5) ảnh: thêm URL ngoài chưa có (storage_key = null), không xóa ảnh hiện có
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
