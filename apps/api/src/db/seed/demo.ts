/**
 * Dữ liệu MẪU để phát triển và thử giao diện: nhóm hàng, ~60 hàng, 3 combo và tồn đầu của 2 chi nhánh.
 * Hoàn toàn GIẢ và xác định (không ngẫu nhiên): tên, tồn do công thức, KHÔNG lấy từ dữ liệu KiotViet thật.
 * Chỉ dùng khi dev/test: từ chối chạy khi NODE_ENV=production. Chạy lại an toàn (hàng mẫu mã `DEMO-…` đã có thì bỏ qua).
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { dec, roundUnitPrice } from '../../common/costing.js';
import type { Database } from '../database.module.js';
import {
  branches,
  categories,
  productComponents,
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
/** Combo mẫu: mã → hàng thành phần (chỉ số hàng mẫu bắt đầu từ 1, như DEMO-001). */
const DEMO_COMBOS: Array<{
  code: string;
  name: string;
  parts: Array<[number, number]>;
}> = [
  {
    code: `${'DEMO-'}CB01`,
    name: 'Combo mẫu 1',
    parts: [
      [1, 2],
      [2, 1],
    ],
  },
  {
    code: `${'DEMO-'}CB02`,
    name: 'Combo mẫu 2',
    parts: [
      [3, 1],
      [4, 3],
      [5, 2],
    ],
  },
  {
    code: `${'DEMO-'}CB03`,
    name: 'Combo mẫu 3',
    parts: [
      [10, 5],
      [11, 1],
    ],
  },
];
const PRODUCT_COUNT = 60;

/** Giá vốn Sài Gòn cao hơn Hà Nội 3%. */
const SG_UPLIFT = '1.03';

export interface DemoSeedReport {
  categories: number;
  products: number;
  combos: number;
  openingMovements: number;
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
    openingMovements: 0,
    combos: 0,
  };
  const inventory = new InventoryService(db);

  await db.transaction(async (tx) => {
    const branchRows = await tx.select().from(branches);
    const hn = branchRows.find((b) => b.code === 'HN');
    const sg = branchRows.find((b) => b.code === 'SG');
    if (!hn || !sg) {
      throw new Error('Chưa có chi nhánh: chạy `pnpm db:seed` trước');
    }

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
    if (fresh.length === 0) {
      await seedCombos(tx, report);
      return;
    }

    const inserted = await tx
      .insert(products)
      .values(
        fresh.map(({ code, i }) => ({
          code,
          name: `Hàng mẫu ${i + 1}`,
          categoryId: leafIds[i % leafIds.length]!,
          isActive: true,
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

    await seedCombos(tx, report);
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

/**
 * Combo mẫu gồm vài hàng mẫu. Combo không có tồn riêng (tồn/giá vốn tính từ thành phần). Chỉ tạo combo CHƯA có và chỉ
 * khi đủ hàng thành phần mẫu.
 */
async function seedCombos(
  tx: Pick<Database, 'select' | 'insert'>,
  report: DemoSeedReport,
): Promise<void> {
  const have = new Set(
    (
      await tx
        .select({ code: products.code })
        .from(products)
        .where(
          inArray(
            products.code,
            DEMO_COMBOS.map((c) => c.code),
          ),
        )
    ).map((p) => p.code),
  );
  const partCode = (n: number) => `${DEMO_PREFIX}${String(n).padStart(3, '0')}`;
  const partRows = await tx
    .select({ id: products.id, code: products.code })
    .from(products)
    .where(
      inArray(
        products.code,
        DEMO_COMBOS.flatMap((c) => c.parts.map(([n]) => partCode(n))),
      ),
    );
  const partId = new Map(partRows.map((p) => [p.code, p.id]));
  for (const combo of DEMO_COMBOS) {
    if (have.has(combo.code)) continue;
    if (!combo.parts.every(([n]) => partId.has(partCode(n)))) continue;
    const [row] = await tx
      .insert(products)
      .values({ code: combo.code, name: combo.name, productType: 'combo' })
      .returning({ id: products.id });
    await tx.insert(productComponents).values(
      combo.parts.map(([n, qty], k) => ({
        comboId: row!.id,
        componentId: partId.get(partCode(n))!,
        qty,
        sortOrder: k,
      })),
    );
    report.combos++;
  }
}
