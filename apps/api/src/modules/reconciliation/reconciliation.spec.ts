import type { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lockPartyBranch } from '../../common/advisory-lock.js';
import type { Database } from '../../db/database.module.js';
import {
  branches,
  cashAccounts,
  cashCategories,
  cashTransactions,
  customers,
  debtLedger,
  products,
  stocks,
} from '../../db/schema/index.js';
import { runDemoSeed } from '../../db/seed/demo.js';
import { runSeed } from '../../db/seed/index.js';
import { createTestDb } from '../../db/test-db.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { StockTransfersService } from '../stock-transfers/stock-transfers.service.js';
import { ReconciliationService } from './reconciliation.service.js';

describe('ReconciliationService (CSDL thật trong bộ nhớ)', () => {
  let client: PGlite;
  let db: Database;
  let hn: string;
  let sg: string;
  const svc = new ReconciliationService();
  const issues = async () =>
    Object.fromEntries(
      (await svc.run(db)).checks.map((c) => [c.code, c.issues]),
    );

  beforeAll(async () => {
    ({ client, db } = await createTestDb());
    await runSeed(db, { adminPassword: 'Mat-khau-thu-nghiem-1' });
    await runDemoSeed(db, { nodeEnv: 'test' });
    const rows = await db.select().from(branches);
    hn = rows.find((b) => b.code === 'HN')!.id;
    sg = rows.find((b) => b.code === 'SG')!.id;
  }, 60_000);
  afterAll(async () => {
    await client.close();
  });

  it('dữ liệu mẫu vừa nạp: mọi phép đối soát đều 0 lệch', async () => {
    const report = await svc.run(db);
    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => c.code)).toEqual([
      'stock_cache_vs_ledger',
      'debt_orphan_party',
      'cash_account_branch',
      'debt_internal_symmetry',
    ]);
  });

  it('sau một lần chuyển kho thật (gửi → nhận): tồn, sổ cái và công nợ nội bộ vẫn khớp', async () => {
    const inv = new InventoryService(db);
    const transfers = new StockTransfersService(db, inv);
    const [a, b] = await db.select().from(products).limit(2);
    const sent = await transfers.create({
      fromBranchId: hn,
      toBranchId: sg,
      shippingFee: '50000',
      items: [
        { productId: a!.id, qty: '3' },
        { productId: b!.id, qty: '2' },
      ],
    });
    await transfers.receive(sent.id);
    expect(await issues()).toEqual({
      stock_cache_vs_ledger: 0,
      debt_orphan_party: 0,
      cash_account_branch: 0,
      debt_internal_symmetry: 0,
    });
  });

  it('bắt được số tồn bị sửa tay (lệch với sổ cái kho) và nêu đúng (chi nhánh, sản phẩm)', async () => {
    const [row] = await db.select().from(stocks).limit(1);
    await db
      .update(stocks)
      .set({ onHand: String(Number(row!.onHand) + 7) })
      .where(
        and(
          eq(stocks.productId, row!.productId),
          eq(stocks.branchId, row!.branchId),
        ),
      );
    const report = await svc.run(db);
    const c = report.checks.find((x) => x.code === 'stock_cache_vs_ledger')!;
    expect(report.ok).toBe(false);
    expect(c.issues).toBeGreaterThanOrEqual(1);
    expect(c.samples[0]).toMatchObject({ product_id: row!.productId });
    // trả lại để các test sau sạch
    await db
      .update(stocks)
      .set({ onHand: row!.onHand })
      .where(
        and(
          eq(stocks.productId, row!.productId),
          eq(stocks.branchId, row!.branchId),
        ),
      );
    expect((await issues()).stock_cache_vs_ledger).toBe(0);
  });

  it('bắt được dòng tồn không có sổ cái và sổ cái không có dòng tồn', async () => {
    const [p] = await db
      .insert(products)
      .values({ code: 'DOICHIEU1', name: 'x' })
      .returning();
    await db
      .insert(stocks)
      .values({ branchId: hn, productId: p!.id, onHand: '5' }); // tồn "ma"
    expect((await issues()).stock_cache_vs_ledger).toBe(1);
    await db.delete(stocks).where(eq(stocks.productId, p!.id));
    expect((await issues()).stock_cache_vs_ledger).toBe(0);
  });

  it('bắt được bút toán công nợ trỏ tới khách không tồn tại', async () => {
    await db.insert(debtLedger).values({
      branchId: sg,
      partyType: 'customer',
      partyId: '00000000-0000-4000-8000-0000000000aa',
      entryType: 'adjustment',
      amount: '1000',
      occurredAt: new Date(),
    });
    expect((await issues()).debt_orphan_party).toBe(1);
  });

  it('bắt được phiếu quỹ ghi vào tài khoản quỹ của chi nhánh khác', async () => {
    const accounts = await db.select().from(cashAccounts);
    const sgAccount = accounts.find((a) => a.branchId === sg)!;
    const [cat] = await db.select().from(cashCategories).limit(1);
    await db.insert(cashTransactions).values({
      code: 'LECH-QUY-1',
      branchId: hn, // phiếu của Hà Nội nhưng ghi vào quỹ Sài Gòn
      direction: 'in',
      amount: '1000',
      categoryId: cat!.id,
      accountId: sgAccount.id,
      occurredAt: new Date(),
    });
    expect((await issues()).cash_account_branch).toBe(1);
  });

  it('bắt được công nợ nội bộ chỉ ghi một phía (thiếu bút toán đối ứng giữa hai chi nhánh)', async () => {
    const [internal] = await db
      .select()
      .from(customers)
      .where(eq(customers.code, 'CN-SG'));
    await db.insert(debtLedger).values({
      branchId: hn,
      partyType: 'customer',
      partyId: internal!.id,
      entryType: 'transfer',
      amount: '500000',
      occurredAt: new Date(),
    });
    expect((await issues()).debt_internal_symmetry).toBeGreaterThanOrEqual(1);
  });
});

describe('lockPartyBranch', () => {
  it('chạy được trong transaction, gọi lặp lại cùng khóa không tự chặn chính nó', async () => {
    const { client, db } = await createTestDb();
    try {
      await db.transaction(async (tx) => {
        await lockPartyBranch(
          tx,
          'customer',
          '11111111-1111-4111-8111-111111111111',
          'b1',
        );
        await lockPartyBranch(
          tx,
          'customer',
          '11111111-1111-4111-8111-111111111111',
          'b1',
        );
        await lockPartyBranch(
          tx,
          'supplier',
          '22222222-2222-4222-8222-222222222222',
          'b2',
        );
      });
    } finally {
      await client.close();
    }
  }, 60_000);
});
