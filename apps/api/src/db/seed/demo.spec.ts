import type { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../database.module.js';
import {
  branches,
  debtLedger,
  products,
  stockMovements,
  stocks,
  supplierBranchHistory,
  suppliers,
} from '../schema/index.js';
import { createTestDb } from '../test-db.js';
import { demoStockHn, demoSupplierFigures, runDemoSeed } from './demo.js';
import { runSeed } from './index.js';

describe('demoStockHn (công thức thuần túy)', () => {
  it('tồn dương và giá vốn có 4 chữ số thập phân, xác định theo chỉ số', () => {
    for (let i = 0; i < 60; i++) {
      const { qty, cost } = demoStockHn(i);
      expect(qty).toBeGreaterThan(0);
      expect(cost).toMatch(/^\d+\.\d{4}$/);
      expect(demoStockHn(i)).toEqual({ qty, cost });
    }
  });
});

describe('demoSupplierFigures (công thức thuần túy)', () => {
  it('xác định, hai chi nhánh khác nhau; có nợ 0 và nợ âm; trừ trả hàng không vượt tổng mua', () => {
    const debts: number[] = [];
    for (let i = 0; i < 8; i++) {
      const hn = demoSupplierFigures(i, 'HN');
      const sg = demoSupplierFigures(i, 'SG');
      expect(demoSupplierFigures(i, 'HN')).toEqual(hn);
      expect(hn.purchaseTotal).not.toBe(sg.purchaseTotal);
      for (const f of [hn, sg]) {
        expect(f.purchaseNet).toBeLessThanOrEqual(f.purchaseTotal);
        expect(f.purchaseNet).toBeGreaterThan(0);
        expect(Number.isInteger(f.debt)).toBe(true);
        debts.push(f.debt);
      }
    }
    expect(debts.some((d) => d === 0)).toBe(true);
    expect(debts.some((d) => d < 0)).toBe(true);
    expect(debts.some((d) => d > 0)).toBe(true);
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
  }, 60_000);

  it('tạo 60 hàng, 3 combo và tồn đầu của 2 chi nhánh', async () => {
    const r = await runDemoSeed(db, { nodeEnv: 'test' });
    expect(r).toMatchObject({
      products: 60,
      combos: 3,
      suppliers: 8,
    });
    // 60 hàng hóa + 3 combo mẫu; combo không có dòng tồn riêng
    const all = await db.select().from(products);
    expect(all).toHaveLength(63);
    const comboIds = all
      .filter((p) => p.productType === 'combo')
      .map((p) => p.id);
    expect(comboIds).toHaveLength(3);

    // nhà cung cấp mẫu: số lịch sử và nợ đầu kỳ RIÊNG từng chi nhánh; nợ chỉ nằm ở sổ cái (dòng opening)
    const sup = (await db.select().from(suppliers)).filter((x) =>
      x.code.startsWith('DEMO-NCC'),
    );
    expect(sup).toHaveLength(8);
    const hist = await db.select().from(supplierBranchHistory);
    expect(hist).toHaveLength(16); // 8 nhà cung cấp × 2 chi nhánh
    const ledger = (await db.select().from(debtLedger)).filter(
      (l) => l.partyType === 'supplier',
    );
    expect(ledger.every((l) => l.entryType === 'opening')).toBe(true);
    const expectedRows = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) =>
      (['HN', 'SG'] as const).filter(
        (b) => demoSupplierFigures(i, b).debt !== 0,
      ),
    ).length;
    expect(ledger).toHaveLength(expectedRows);

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
    expect(st.some((s) => comboIds.includes(s.productId))).toBe(false);
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
  });

  it('chạy lại không tạo trùng và không nhân đôi tồn', async () => {
    const snapshot = async () => ({
      products: (await db.select().from(products)).length,
      moves: (await db.select().from(stockMovements)).length,
      debts: (await db.select().from(debtLedger)).length,
      hist: (await db.select().from(supplierBranchHistory)).length,
    });
    const before = await snapshot();
    const again = await runDemoSeed(db, { nodeEnv: 'test' });
    expect(again).toEqual({
      products: 0,
      combos: 0,
      suppliers: 0,
      openingMovements: 0,
    });
    expect(await snapshot()).toEqual(before);
  });
});
