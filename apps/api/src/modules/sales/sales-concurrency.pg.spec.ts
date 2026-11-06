import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../../common/auth-user.js';
import type { Database } from '../../db/database.module.js';
import * as schema from '../../db/schema/index.js';
import { runSeed } from '../../db/seed/index.js';
import { AuditService } from '../audit/audit.service.js';
import { PermissionsService } from '../authorization/permissions.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { ReconciliationService } from '../reconciliation/reconciliation.service.js';
import { InvoicesService } from './invoices.service.js';
import { OrdersService } from './orders.service.js';

/**
 * Chạy trên PostgreSQL THẬT với nhiều kết nối (PGlite chỉ có một kết nối nên không tái hiện được bế tắc/đua).
 * Bỏ qua nếu không đặt PG_TEST_URL. Cách chạy:
 *   1. Tạo CSDL tạm rỗng và migrate: DATABASE_URL=postgres://.../kiot_conc pnpm db:migrate
 *   2. PG_TEST_URL=postgres://.../kiot_conc pnpm --filter @kiot/api exec vitest run sales-concurrency
 * Test GHI vào CSDL đó nên TUYỆT ĐỐI không trỏ vào CSDL thật.
 */
const URL = process.env.PG_TEST_URL;

describe.skipIf(!URL)('Bán hàng: đồng thời trên PostgreSQL thật', () => {
  let pool: Pool;
  let db: Database;
  let invoices: InvoicesService;
  let orders: OrdersService;
  let manager: AuthUser;
  let sg: string;
  let customerId: string;
  let cashSg: string;
  const pid: Record<string, string> = {};

  const stock = async (code: string) =>
    Number(
      (
        await db
          .select({ v: schema.stocks.onHand })
          .from(schema.stocks)
          .where(
            and(
              eq(schema.stocks.branchId, sg),
              eq(schema.stocks.productId, pid[code]!),
            ),
          )
      )[0]?.v ?? 0,
    );
  const debt = async () =>
    Number(
      (
        await db
          .select({
            v: sql<string>`coalesce(sum(${schema.debtLedger.amount}), 0)`,
          })
          .from(schema.debtLedger)
          .where(
            and(
              eq(schema.debtLedger.partyType, 'customer'),
              eq(schema.debtLedger.partyId, customerId),
              eq(schema.debtLedger.branchId, sg),
            ),
          )
      )[0]!.v,
    );
  const line = (code: string, qty: string, price: string) => ({
    productId: pid[code]!,
    qty,
    price,
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
    const [acc] = await db
      .select()
      .from(schema.cashAccounts)
      .where(
        and(
          eq(schema.cashAccounts.branchId, sg),
          eq(schema.cashAccounts.type, 'cash'),
        ),
      );
    cashSg = acc!.id;
    const audit = new AuditService();
    const perms = new PermissionsService(db);
    const inv = new InventoryService(db);
    orders = new OrdersService(db, audit, perms);
    invoices = new InvoicesService(db, audit, perms, inv, orders);
    const rows = await db
      .insert(schema.products)
      .values(['A', 'B'].map((c) => ({ code: `SC-${c}`, name: c })))
      .returning();
    for (const r of rows) pid[r.code.slice(3)] = r.id;
    const [c] = await db
      .insert(schema.customers)
      .values({ code: 'KC-1', name: 'Khách đồng thời' })
      .returning();
    customerId = c!.id;
    await db.transaction((tx) =>
      inv.applyMovements(tx, [
        { branchId: sg, productId: pid.A!, qtyDelta: '1000', unitCost: '100', refType: 'opening' },
        { branchId: sg, productId: pid.B!, qtyDelta: '1000', unitCost: '200', refType: 'opening' },
      ]),
    );
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('nhiều hóa đơn cùng hai mặt hàng theo thứ tự NGƯỢC nhau chạy đồng thời: không bế tắc, tồn và nợ đúng', async () => {
    const N = 20;
    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        invoices.create(manager, sg, {
          customerId,
          items:
            i % 2 === 0
              ? [line('A', '2', '1000'), line('B', '3', '2000')]
              : [line('B', '3', '2000'), line('A', '2', '1000')],
          payments: [{ method: 'cash', accountId: cashSg, amount: '1000' }],
        }),
      ),
    );
    expect(
      results
        .filter((r) => r.status === 'rejected')
        .map((r) => String((r as PromiseRejectedResult).reason)),
    ).toEqual([]);
    expect(await stock('A')).toBe(1000 - N * 2);
    expect(await stock('B')).toBe(1000 - N * 3);
    expect(await debt()).toBe(N * (2000 + 6000 - 1000));
    expect((await new ReconciliationService().run(db)).ok).toBe(true);
  }, 120_000);

  it('xuất hóa đơn từ CÙNG một phiếu tạm song song: đúng một hóa đơn, trừ kho một lần', async () => {
    const order = await orders.create(manager, sg, {
      customerId,
      items: [line('A', '5', '1000')],
    });
    const stockBefore = await stock('A');
    const debtBefore = await debt();
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        invoices.createFromOrder(manager, sg, order.id, {}),
      ),
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    for (const r of attempts.filter(
      (a): a is PromiseRejectedResult => a.status === 'rejected',
    )) {
      expect((r.reason as { code?: string }).code).toBe('INVALID_STATE');
    }
    expect(await stock('A')).toBe(stockBefore - 5);
    expect(await debt()).toBe(debtBefore + 5000);
    expect((await new ReconciliationService().run(db)).ok).toBe(true);
  }, 120_000);

  it('hủy cùng một hóa đơn song song: đúng một lần thành công, kho/nợ/quỹ chỉ đảo một lần', async () => {
    const inv = await invoices.create(manager, sg, {
      customerId,
      items: [line('B', '7', '2000')],
      payments: [{ method: 'cash', accountId: cashSg, amount: '4000' }],
    });
    const stockBefore = await stock('B');
    const debtBefore = await debt();
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        invoices.cancel(manager, sg, inv.id, 'đua'),
      ),
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    expect(await stock('B')).toBe(stockBefore + 7);
    expect(await debt()).toBe(debtBefore - (14000 - 4000));
    const cash = await db
      .select()
      .from(schema.cashTransactions)
      .where(eq(schema.cashTransactions.refId, inv.id));
    expect(cash.map((c) => c.status)).toEqual(['cancelled']);
    expect((await new ReconciliationService().run(db)).ok).toBe(true);
  }, 120_000);

  it('hủy cùng một hóa đơn KHÔNG có khoản thu song song: kho và nợ chỉ đảo một lần (không còn trigger sổ quỹ đỡ hộ)', async () => {
    const inv = await invoices.create(manager, sg, {
      customerId,
      items: [line('B', '9', '2000')],
    });
    const stockBefore = await stock('B');
    const debtBefore = await debt();
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        invoices.cancel(manager, sg, inv.id, 'đua'),
      ),
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    expect(await stock('B')).toBe(stockBefore + 9);
    expect(await debt()).toBe(debtBefore - 18000);
    expect((await new ReconciliationService().run(db)).ok).toBe(true);
  }, 120_000);
});
