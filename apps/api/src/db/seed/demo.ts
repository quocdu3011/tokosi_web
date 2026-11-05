/**
 * Dữ liệu MẪU để phát triển và thử giao diện: nhóm hàng, ~60 hàng, tồn đầu và giá của cả 7 bảng giá × 2 chi nhánh.
 * Hoàn toàn GIẢ và xác định (không ngẫu nhiên): tên, giá, tồn do công thức, KHÔNG lấy từ dữ liệu KiotViet thật.
 * Chỉ dùng khi dev/test: từ chối chạy khi NODE_ENV=production. Chạy lại an toàn (hàng mẫu mã `DEMO-…` đã có thì bỏ qua).
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { dec, roundUnitPrice } from '../../common/costing.js';
import type { Database } from '../database.module.js';
import {
  branches,
  categories,
  priceBookItems,
  priceBooks,
  products,
} from '../schema/index.js';
import { InventoryService } from '../../modules/inventory/inventory.service.js';

export const DEMO_PREFIX = 'DEMO-';

/** Nhóm hàng 2 cấp: gốc → các nhóm con. */
const CATEGORY_TREE: Array<{ name: string; children: string[] }> = [
  { name: 'NHÀ BẾP', children: ['Dao kéo', 'Nồi chảo'] },
  { name: 'ĐIỆN GIA DỤNG', children: ['Quạt điện', 'Nồi cơm điện'] },
  { name: 'NHÀ CỬA ĐỜI SỐNG', children: ['Sửa chữa', 'Dọn dẹp'] },
  { name: 'MẸ BÉ', children: ['Bình sữa', 'Đồ chơi'] },
];
const UNITS = ['Cái', 'Bộ', 'Hộp'] as const;
const PRODUCT_COUNT = 60;

/** Bảng giá và quy tắc suy ra từ Bảng giá chung (hệ số nhân), theo thứ tự cố định. */
const TIERS = [
  { code: 'LON', factor: '0.94', blankEvery: 10 },
  { code: 'VUA', factor: '0.97', blankEvery: 10 },
  { code: 'VIP', factor: '0.92', blankEvery: 10 },
] as const;
const VAT_TIERS = [
  { code: 'LON_VAT', from: 'LON', blankEvery: 3 },
  { code: 'VUA_VAT', from: 'VUA', blankEvery: 3 },
  { code: 'VIP_VAT', from: 'VIP', blankEvery: 3 },
] as const;
/** Giá Sài Gòn cao hơn Hà Nội 3%; giá vốn Sài Gòn cũng cao hơn 3%. */
const SG_UPLIFT = '1.03';
const VAT_RATE = '1.10';

export interface DemoSeedReport {
  categories: number;
  products: number;
  priceCells: number;
  openingMovements: number;
}

/** Làm tròn nửa lên tới bội số 100 đồng. */
export const roundTo100 = (v: Decimal.Value): Decimal =>
  new Decimal(v).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).times(100);

/** Giá của một hàng theo mã bảng giá, chi nhánh; `null` = ô bỏ trống có chủ đích. Thuần túy để test được. */
export function demoPrices(
  index: number,
  hnCost: Decimal.Value,
  branch: 'HN' | 'SG',
): Record<string, string | null> {
  const margin = new Decimal('0.25').plus(
    new Decimal((index * 11) % 16).div(100),
  );
  let chung = roundTo100(
    new Decimal(hnCost).times(new Decimal(1).plus(margin)),
  );
  if (branch === 'SG') chung = roundTo100(chung.times(SG_UPLIFT));
  const out: Record<string, string | null> = { CHUNG: chung.toFixed(0) };
  const tierPrice: Record<string, Decimal> = {};
  TIERS.forEach((t, k) => {
    const p = roundTo100(chung.times(t.factor));
    tierPrice[t.code] = p;
    out[t.code] = (index + k) % t.blankEvery === 0 ? null : p.toFixed(0);
  });
  VAT_TIERS.forEach((t, k) => {
    const p = roundTo100(tierPrice[t.from]!.times(VAT_RATE));
    out[t.code] = (index + k) % t.blankEvery === 0 ? null : p.toFixed(0);
  });
  return out;
}

/** Giá vốn, tồn đầu mẫu của hàng thứ `index` tại Hà Nội. */
export function demoStockHn(index: number): { qty: number; cost: string } {
  const cost = new Decimal(5000 + ((index * 37) % 90) * 1000).plus(
    index % 2 === 0 ? '0.5' : '0',
  );
  return { qty: 20 + ((index * 13) % 480), cost: cost.toFixed(4) };
}

export async function runDemoSeed(
  db: Database,
  options: { nodeEnv?: string } = {},
): Promise<DemoSeedReport> {
  if ((options.nodeEnv ?? process.env.NODE_ENV) === 'production') {
    throw new Error(
      'Dữ liệu mẫu chỉ dùng để phát triển: từ chối chạy khi NODE_ENV=production',
    );
  }
  const report: DemoSeedReport = {
    categories: 0,
    products: 0,
    priceCells: 0,
    openingMovements: 0,
  };
  const inventory = new InventoryService(db);

  await db.transaction(async (tx) => {
    const branchRows = await tx.select().from(branches);
    const hn = branchRows.find((b) => b.code === 'HN');
    const sg = branchRows.find((b) => b.code === 'SG');
    const books = await tx.select().from(priceBooks);
    if (!hn || !sg || books.length === 0) {
      throw new Error(
        'Chưa có chi nhánh / bảng giá: chạy `pnpm db:seed` trước',
      );
    }
    const bookId = new Map(books.map((b) => [b.code, b.id]));

    // nhóm hàng
    const leafIds: string[] = [];
    for (const root of CATEGORY_TREE) {
      const rootId = await ensureCategory(tx, null, root.name, report);
      for (const child of root.children) {
        leafIds.push(await ensureCategory(tx, rootId, child, report));
      }
    }

    // hàng hóa: chỉ xử lý hàng CHƯA có, để chạy lại không nhân đôi tồn và không ghi đè giá đã chỉnh
    const codes = Array.from(
      { length: PRODUCT_COUNT },
      (_, i) => `${DEMO_PREFIX}${String(i + 1).padStart(3, '0')}`,
    );
    const have = new Set(
      (
        await tx
          .select({ code: products.code })
          .from(products)
          .where(inArray(products.code, codes))
      ).map((p) => p.code),
    );
    const fresh = codes
      .map((code, i) => ({ code, i }))
      .filter(({ code }) => !have.has(code));
    if (fresh.length === 0) return;

    const inserted = await tx
      .insert(products)
      .values(
        fresh.map(({ code, i }) => ({
          code,
          name: `Hàng mẫu ${i + 1}`,
          unit: UNITS[i % UNITS.length]!,
          categoryId: leafIds[i % leafIds.length]!,
          isActive: true,
          isSellable: true,
        })),
      )
      .returning({ id: products.id, code: products.code });
    const idOf = new Map(inserted.map((p) => [p.code, p.id]));
    report.products = inserted.length;

    // tồn đầu qua cổng duy nhất (InventoryService), mỗi chi nhánh một lần gọi nhiều dòng
    const movements = (branchId: string, uplift: boolean) =>
      fresh.flatMap(({ code, i }) => {
        const hnStock = demoStockHn(i);
        // Sài Gòn: cứ 9 hàng có 1 hàng hết tồn để thử bộ lọc còn tồn
        const qty = uplift
          ? i % 9 === 0
            ? 0
            : 10 + ((i * 7) % 300)
          : hnStock.qty;
        if (qty === 0) return []; // vài hàng hết tồn ở Sài Gòn để thử bộ lọc
        const cost = uplift
          ? roundUnitPrice(dec(hnStock.cost).times(SG_UPLIFT))
          : hnStock.cost;
        return [
          {
            branchId,
            productId: idOf.get(code)!,
            qtyDelta: String(qty),
            unitCost: cost,
            refType: 'opening' as const,
            refCode: 'DEMO',
          },
        ];
      });
    for (const [branchId, uplift] of [
      [hn.id, false],
      [sg.id, true],
    ] as const) {
      const list = movements(branchId, uplift);
      if (list.length > 0) {
        await inventory.applyMovements(tx, list);
        report.openingMovements += list.length;
      }
    }

    // giá của cả 7 bảng giá × 2 chi nhánh
    const cells: Array<typeof priceBookItems.$inferInsert> = [];
    for (const { code, i } of fresh) {
      for (const [branch, id] of [
        ['HN', hn.id],
        ['SG', sg.id],
      ] as const) {
        const prices = demoPrices(i, demoStockHn(i).cost, branch);
        for (const [bookCode, price] of Object.entries(prices)) {
          if (price === null) continue;
          cells.push({
            priceBookId: bookId.get(bookCode)!,
            branchId: id,
            productId: idOf.get(code)!,
            price,
          });
        }
      }
    }
    // thứ tự cố định (bảng giá, chi nhánh, sản phẩm) như mọi nơi ghi giá hàng loạt
    cells.sort(
      (a, b) =>
        a.priceBookId.localeCompare(b.priceBookId) ||
        a.branchId.localeCompare(b.branchId) ||
        a.productId.localeCompare(b.productId),
    );
    for (let k = 0; k < cells.length; k += 500) {
      await tx.insert(priceBookItems).values(cells.slice(k, k + 500));
    }
    report.priceCells = cells.length;
  });
  return report;
}

async function ensureCategory(
  tx: Pick<Database, 'select' | 'insert'>,
  parentId: string | null,
  name: string,
  report: DemoSeedReport,
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
  const [row] = await tx
    .insert(categories)
    .values({ name, parentId })
    .returning({ id: categories.id });
  report.categories++;
  return row!.id;
}
