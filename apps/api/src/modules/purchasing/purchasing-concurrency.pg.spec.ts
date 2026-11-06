import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../../common/auth-user.js';
import type { Database } from '../../db/database.module.js';
import * as schema from '../../db/schema/index.js';
import { runSeed } from '../../db/seed/index.js';
import { AuditService } from '../audit/audit.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { ReconciliationService } from '../reconciliation/reconciliation.service.js';
import { GoodsReceiptsService } from './goods-receipts.service.js';
import { PurchaseReturnsService } from './purchase-returns.service.js';

/**
 * Chạy trên PostgreSQL THẬT với nhiều kết nối (PGlite chỉ có một kết nối nên không tái hiện được bế tắc/đua).
 * Bỏ qua nếu không đặt PG_TEST_URL. Cách chạy:
 *   1. Tạo CSDL tạm rỗng và migrate: DATABASE_URL=postgres://.../kiot_conc pnpm db:migrate
 *   2. PG_TEST_URL=postgres://.../kiot_conc pnpm --filter @kiot/api exec vitest run purchasing-concurrency
 * Test GHI vào CSDL đó nên TUYỆT ĐỐI không trỏ vào CSDL thật.
 */
const URL = process.env.PG_TEST_URL;

describe.skipIf(!URL)('Mua hàng: đồng thời trên PostgreSQL thật', () => {
  let pool: Pool;
  let db: Database;
  let receipts: GoodsReceiptsService;
  let returns: PurchaseReturnsService;
  let manager: AuthUser;
  let sg: string;
  let supplierId: string;
  const pid: Record<string, string> = {};

  const stock = async (code: string) => {
    const [r] = await db
      .select({ onHand: schema.stocks.onHand })
      .from(schema.stocks)
      .where(
        and(
          eq(schema.stocks.branchId, sg),
          eq(schema.stocks.productId, pid[code]!),
        ),
      );
    return Number(r?.onHand ?? 0);
  };
  const debt = async () => {
    const [r] = await db
      .select({ v: sql<string>`coalesce(sum(${schema.debtLedger.amount}), 0)` })
      .from(schema.debtLedger)
      .where(
        and(
          eq(schema.debtLedger.partyId, supplierId),
          eq(schema.debtLedger.branchId, sg),
        ),
      );
    return Number(r!.v);
  };
  const line = (code: string, qty: string, unitCost: string) => ({
    productId: pid[code]!,
    qty,
    unitCost,
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL, max: 16 });
    db = drizzle({ client: pool, schema, casing: 'snake_case' }) as Database;
    const [{ n }] = (
      await pool.query(
        `select (select count(*) from products) + (select count(*) from users) as n`,
      )
    ).rows as [{ n: string }];
    if (Number(n) !== 0) {
      throw new Error(
        'PG_TEST_URL phải trỏ vào CSDL tạm còn TRỐNG (đã migrate, chưa có dữ liệu); từ chối chạy.',
      );
    }
    await runSeed(db, { adminPassword: 'Mat-khau-thu-nghiem-1' });
    const [m] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.role, 'manager'));
    manager = { id: m!.id, role: 'manager' };
    const [b] = await db
      .select()
      .from(schema.branches)
      .where(eq(schema.branches.code, 'SG'));
    sg = b!.id;
    const inv = new InventoryService(db);
    receipts = new GoodsReceiptsService(db, new AuditService(), inv);
    returns = new PurchaseReturnsService(db, new AuditService(), inv);
    const [s] = await db
      .insert(schema.suppliers)
      .values({ code: 'NCC-CC', name: 'NCC thử đồng thời' })
      .returning();
    supplierId = s!.id;
    const rows = await db
      .insert(schema.products)
      .values(['A', 'B', 'C'].map((c) => ({ code: `CC-${c}`, name: c })))
      .returning();
    for (const r of rows) pid[r.code.slice(3)] = r.id;
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('nhiều phiếu nhập cùng hai mặt hàng theo thứ tự NGƯỢC nhau chạy đồng thời: không bế tắc, tồn và nợ cộng đúng', async () => {
    const N = 20;
    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        receipts.create(manager, sg, {
          supplierId,
          items:
            i % 2 === 0
              ? [line('A', '10', '100'), line('B', '10', '200')]
              : [line('B', '10', '200'), line('A', '10', '100')],
        }),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    expect(failed.map((f) => (f as PromiseRejectedResult).reason)).toEqual([]);
    expect(await stock('A')).toBe(N * 10);
    expect(await stock('B')).toBe(N * 10);
    expect(await debt()).toBe(N * (1000 + 2000));
    expect((await new ReconciliationService().run(db)).ok).toBe(true);
  }, 60_000);

  it('hai phiếu trả song song cùng một phiếu nhập: tổng trả không vượt số đã nhập (khóa phiếu nhập gốc)', async () => {
    const gr = await receipts.create(manager, sg, {
      supplierId,
      items: [line('C', '100', '50')],
    });
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        returns.create(manager, sg, {
          supplierId,
          goodsReceiptId: gr.id,
          items: [{ productId: pid['C']!, qty: '20', returnPrice: '50' }],
        }),
      ),
    );
    const ok = attempts.filter((a) => a.status === 'fulfilled');
    const rejected = attempts.filter(
      (a): a is PromiseRejectedResult => a.status === 'rejected',
    );
    expect(ok).toHaveLength(5); // 5 × 20 = 100
    expect(rejected).toHaveLength(5);
    for (const r of rejected) {
      expect((r.reason as { code?: string }).code).toBe('RETURN_QTY_EXCEEDED');
    }
    expect(await stock('C')).toBe(0);
    expect((await new ReconciliationService().run(db)).ok).toBe(true);
  }, 60_000);

  it('hủy cùng một phiếu nhập song song: đúng một lần thành công, tồn và nợ chỉ đảo một lần', async () => {
    const gr = await receipts.create(manager, sg, {
      supplierId,
      items: [line('C', '30', '10')],
    });
    const stockBefore = await stock('C');
    const debtBefore = await debt();
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        receipts.cancel(manager, sg, gr.id, 'đua'),
      ),
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    expect(await stock('C')).toBe(stockBefore - 30);
    expect(await debt()).toBe(debtBefore - 300);
    expect((await new ReconciliationService().run(db)).ok).toBe(true);
  }, 60_000);
});
