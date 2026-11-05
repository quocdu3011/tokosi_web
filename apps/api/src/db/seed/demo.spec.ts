import type { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../database.module.js';
import {
  branches,
  categories,
  priceBookItems,
  priceBooks,
  products,
  stockMovements,
  stocks,
} from '../schema/index.js';
import { createTestDb } from '../test-db.js';
import { demoPrices, demoStockHn, roundTo100, runDemoSeed } from './demo.js';
import { runSeed } from './index.js';

describe('demoPrices (công thức thuần túy)', () => {
  it('mọi giá là số nguyên đồng, bội số của 100; Lớn/Vừa/VIP không vượt Bảng giá chung', () => {
    for (let i = 0; i < 60; i++) {
      const { cost } = demoStockHn(i);
      for (const branch of ['HN', 'SG'] as const) {
        const p = demoPrices(i, cost, branch);
        const chung = Number(p.CHUNG);
        expect(chung).toBeGreaterThan(Number(cost)); // luôn có lãi
        for (const v of Object.values(p)) {
          if (v === null) continue;
          expect(v).toMatch(/^\d+$/);
          expect(Number(v) % 100).toBe(0);
        }
        for (const code of ['LON', 'VUA', 'VIP']) {
          if (p[code] !== null)
            expect(Number(p[code])).toBeLessThanOrEqual(chung);
        }
      }
    }
  });

  it('Sài Gòn cao hơn Hà Nội; ví dụ số cố định', () => {
    const hn = demoPrices(0, '10000.5000', 'HN');
    const sg = demoPrices(0, '10000.5000', 'SG');
    expect(Number(sg.CHUNG)).toBeGreaterThan(Number(hn.CHUNG));
    // index 0: lời 25% → 12.500,6 → 12.500; Sài Gòn ×1,03 = 12.875 → 12.900
    expect(hn.CHUNG).toBe('12500');
    expect(sg.CHUNG).toBe('12900');
    expect(hn.LON).toBeNull(); // (0+0) % 10 === 0 → bỏ trống có chủ đích
    expect(hn.VUA).toBe('12100'); // 12.500 × 0,97 = 12.125 → 12.100 (chỉ bảng Lớn bỏ trống ở hàng 0)
    expect(hn.LON_VAT).toBeNull();
  });

  it('roundTo100 làm tròn nửa lên', () => {
    expect(roundTo100('12349.99').toFixed(0)).toBe('12300');
    expect(roundTo100('12350').toFixed(0)).toBe('12400');
  });
});

describe('runDemoSeed (CSDL thật trong bộ nhớ)', () => {
  let client: PGlite;
  let db: Database;

  beforeAll(async () => {
    ({ client, db } = await createTestDb());
    await runSeed(db, { adminPassword: 'Mat-khau-thu-nghiem-1' });
  }, 60_000);
  afterAll(async () => {
    await client.close();
  });

  it('từ chối chạy ở production; từ chối khi chưa có seed nền', async () => {
    await expect(runDemoSeed(db, { nodeEnv: 'production' })).rejects.toThrow(
      /production/,
    );
    const empty = await createTestDb();
    try {
      await expect(runDemoSeed(empty.db, { nodeEnv: 'test' })).rejects.toThrow(
        /db:seed/,
      );
    } finally {
      await empty.client.close();
    }
  });

  it('tạo 60 hàng, nhóm hàng 2 cấp, tồn đầu và giá của cả 7 bảng giá × 2 chi nhánh', async () => {
    const r = await runDemoSeed(db, { nodeEnv: 'test' });
    expect(r).toMatchObject({ categories: 12, products: 60 });
    expect(await db.select().from(products)).toHaveLength(60);
    expect(await db.select().from(categories)).toHaveLength(12);

    const [hn] = await db
      .select()
      .from(branches)
      .where(eq(branches.code, 'HN'));
    const [sg] = await db
      .select()
      .from(branches)
      .where(eq(branches.code, 'SG'));
    const st = await db.select().from(stocks);
    const hnStocks = st.filter((s) => s.branchId === hn!.id);
    const sgStocks = st.filter((s) => s.branchId === sg!.id);
    expect(hnStocks).toHaveLength(60);
    expect(sgStocks.length).toBeLessThan(60); // vài hàng hết tồn ở Sài Gòn
    expect(sgStocks.length).toBeGreaterThan(40);
    // giá vốn Sài Gòn khác (cao hơn) Hà Nội
    const costOf = (rows: typeof st) =>
      new Map(rows.map((s) => [s.productId, Number(s.costPrice)]));
    const hnCost = costOf(hnStocks);
    for (const [pid, cost] of costOf(sgStocks)) {
      expect(cost).toBeGreaterThan(hnCost.get(pid)!);
    }
    // sổ cái kho khớp số tồn (tồn chỉ đổi qua sổ cái)
    const moves = await db.select().from(stockMovements);
    expect(moves.every((m) => m.refType === 'opening')).toBe(true);
    for (const s of st) {
      const sum = moves
        .filter((m) => m.productId === s.productId && m.branchId === s.branchId)
        .reduce((a, m) => a + Number(m.qtyDelta), 0);
      expect(sum).toBe(Number(s.onHand));
    }

    // giá: số nguyên đồng; có ô trống có chủ đích; Bảng giá chung luôn có ở cả hai chi nhánh
    const cells = await db.select().from(priceBookItems);
    expect(cells.every((c) => /^\d+\.0000$/.test(c.price))).toBe(true);
    const chung = (await db.select().from(priceBooks)).find(
      (b) => b.code === 'CHUNG',
    )!;
    expect(cells.filter((c) => c.priceBookId === chung.id)).toHaveLength(120); // 60 hàng × 2 chi nhánh
    expect(cells.length).toBeLessThan(60 * 2 * 7); // có ô bỏ trống
    expect(cells.length).toBeGreaterThan(60 * 2 * 4);
    expect(r.priceCells).toBe(cells.length);
  });

  it('chạy lại không tạo trùng và không nhân đôi tồn / giá', async () => {
    const snapshot = async () => ({
      products: (await db.select().from(products)).length,
      moves: (await db.select().from(stockMovements)).length,
      cells: (await db.select().from(priceBookItems)).length,
      cats: (await db.select().from(categories)).length,
    });
    const before = await snapshot();
    const again = await runDemoSeed(db, { nodeEnv: 'test' });
    expect(again).toEqual({
      categories: 0,
      products: 0,
      priceCells: 0,
      openingMovements: 0,
    });
    expect(await snapshot()).toEqual(before);
  });
});
