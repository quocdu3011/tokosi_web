import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lockPartyBranch } from '../../common/advisory-lock.js';
import type { AuthUser } from '../../common/auth-user.js';
import type { DbOrTx } from '../../db/database.module.js';
import type { Database } from '../../db/database.module.js';
import * as schema from '../../db/schema/index.js';
import { runSeed } from '../../db/seed/index.js';
import { AuditService } from '../audit/audit.service.js';
import { PermissionsService } from '../authorization/permissions.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { importCashTransactions } from '../imports/cash.importer.js';
import { ReconciliationService } from '../reconciliation/reconciliation.service.js';
import { InvoicesService } from '../sales/invoices.service.js';
import { OrdersService } from '../sales/orders.service.js';
import { CashAccountsService } from './cash-accounts.service.js';
import { CashTransactionsService } from './cash-transactions.service.js';

/**
 * Chạy trên PostgreSQL THẬT với nhiều kết nối (PGlite chỉ có một kết nối nên không tái hiện được đua/bế tắc).
 * Bỏ qua nếu không đặt PG_TEST_URL. Cách chạy:
 *   1. Tạo CSDL tạm rỗng và migrate: DATABASE_URL=postgres://.../kiot_conc pnpm db:migrate
 *   2. PG_TEST_URL=postgres://.../kiot_conc pnpm --filter @kiot/api exec vitest run cash-concurrency
 * Test GHI vào CSDL đó nên TUYỆT ĐỐI không trỏ vào CSDL thật.
 */
const URL = process.env.PG_TEST_URL;

describe.skipIf(!URL)('Sổ quỹ: đồng thời trên PostgreSQL thật', () => {
  let pool: Pool;
  let db: Database;
  let invoices: InvoicesService;
  let cash: CashTransactionsService;
  let manager: AuthUser;
  let sg: string;
  let cashSg: string;
  let productId: string;
  let paymentCat: string;

  const newCustomer = async (code: string) =>
    (await db.insert(schema.customers).values({ code, name: code }).returning())[0]!.id;
  const newInvoice = async (customerId: string, price: string) =>
    (
      await invoices.create(manager, sg, {
        customerId,
        items: [{ productId, qty: '1', price }],
      })
    ).id;
  const debt = async (customerId: string) =>
    Number(
      (
        await db
          .select({ v: sql<string>`coalesce(sum(${schema.debtLedger.amount}), 0)` })
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
  const allocatedTo = async (invoiceId: string) =>
    Number(
      (
        await db
          .select({ v: sql<string>`coalesce(sum(${schema.paymentAllocations.amount}), 0)` })
          .from(schema.paymentAllocations)
          .innerJoin(
            schema.cashTransactions,
            eq(schema.cashTransactions.id, schema.paymentAllocations.cashTransactionId),
          )
          .where(
            and(
              eq(schema.paymentAllocations.invoiceId, invoiceId),
              eq(schema.cashTransactions.status, 'completed'),
            ),
          )
      )[0]!.v,
    );
  const receipt = (customerId: string, amount: string, allocations?: Array<{ invoiceId: string; amount: string }>) =>
    cash.create(manager, sg, {
      direction: 'in',
      amount,
      categoryId: paymentCat,
      accountId: cashSg,
      party: { type: 'customer', id: customerId },
      ...(allocations ? { allocations } : {}),
    });

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL, max: 16 });
    db = drizzle({ client: pool, schema, casing: 'snake_case' }) as Database;
    const [{ n }] = (
      await pool.query(`select (select count(*) from products) + (select count(*) from users) as n`)
    ).rows as [{ n: string }];
    if (Number(n) !== 0) {
      throw new Error('PG_TEST_URL phải trỏ vào CSDL tạm còn TRỐNG (đã migrate, chưa có dữ liệu); từ chối chạy.');
    }
    await runSeed(db, { adminPassword: 'Mat-khau-thu-nghiem-1' });
    const [m] = await db.select().from(schema.users).where(eq(schema.users.role, 'manager'));
    manager = { id: m!.id, role: 'manager' };
    sg = (await db.select().from(schema.branches).where(eq(schema.branches.code, 'SG')))[0]!.id;
    cashSg = (
      await db
        .select()
        .from(schema.cashAccounts)
        .where(and(eq(schema.cashAccounts.branchId, sg), eq(schema.cashAccounts.type, 'cash')))
    )[0]!.id;
    paymentCat = (
      await db.select().from(schema.cashCategories).where(eq(schema.cashCategories.code, 'customer_payment'))
    )[0]!.id;
    const audit = new AuditService();
    const perms = new PermissionsService(db);
    const inv = new InventoryService(db);
    invoices = new InvoicesService(db, audit, perms, inv, new OrdersService(db, audit, perms));
    cash = new CashTransactionsService(db, audit, new CashAccountsService(db, audit));
    productId = (await db.insert(schema.products).values({ code: 'CC-A', name: 'A' }).returning())[0]!.id;
    await db.transaction((tx) =>
      inv.applyMovements(tx, [
        { branchId: sg, productId, qtyDelta: '1000', unitCost: '100', refType: 'opening' },
      ]),
    );
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('nhiều phiếu thu tự cấn song song cùng một khách: tổng cấn đúng bằng số còn nợ, phần dư thành trả trước, không cấn vượt', async () => {
    const customerId = await newCustomer('CC-K1');
    const invoiceId = await newInvoice(customerId, '100000');
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => receipt(customerId, '30000')));
    expect(
      results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason)),
    ).toEqual([]);
    expect(await allocatedTo(invoiceId)).toBe(100000); // không thể cấn quá 100.000
    expect(await debt(customerId)).toBe(100000 - 8 * 30000);
    expect((await new ReconciliationService().run(db)).ok).toBe(true);
  }, 120_000);

  it('thu nợ cấn tay song song với hủy hóa đơn: không bao giờ vừa hủy hóa đơn vừa còn tiền cấn trừ vào nó', async () => {
    for (let i = 0; i < 6; i++) {
      const customerId = await newCustomer(`CC-K2-${i}`);
      const invoiceId = await newInvoice(customerId, '50000');
      const [r, c] = await Promise.allSettled([
        receipt(customerId, '50000', [{ invoiceId, amount: '50000' }]),
        invoices.cancel(manager, sg, invoiceId, 'thử đồng thời'),
      ]);
      const [row] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
      if (row!.status === 'cancelled') {
        expect(await allocatedTo(invoiceId), `lần ${i}`).toBe(0);
        expect(r.status).toBe('rejected'); // phiếu thu không cấn được vào hóa đơn đã hủy
      } else {
        expect(c.status).toBe('rejected'); // đã có tiền cấn trừ thì hóa đơn không hủy được
        expect(await allocatedTo(invoiceId)).toBe(50000);
      }
    }
    expect((await new ReconciliationService().run(db)).ok).toBe(true);
  }, 120_000);

  it('hủy cùng một phiếu thu song song: đảo công nợ đúng một lần', async () => {
    const customerId = await newCustomer('CC-K3');
    await newInvoice(customerId, '70000');
    const made = await receipt(customerId, '70000');
    expect(await debt(customerId)).toBe(0);
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, () => cash.cancel(sg, made.id, 'hủy đồng thời')),
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    expect(await debt(customerId)).toBe(70000); // đảo một lần: nợ về lại 70.000
    expect((await new ReconciliationService().run(db)).ok).toBe(true);
  }, 120_000);

  /**
   * Giữ một khóa trong transaction riêng rồi chạy `op`: `op` PHẢI chờ (không xong trong 500ms) cho tới khi nhả khóa.
   * Khóa bộ đếm mã phiếu và trigger của sổ quỹ vô tình che mất đua dữ liệu nên test song song không chứng minh được
   * các khóa tường minh; test này chứng minh trực tiếp rằng nghiệp vụ có lấy khóa đó.
   */
  const waitsFor = async (hold: (tx: DbOrTx) => Promise<void>, op: () => Promise<unknown>) => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let ready!: () => void;
    const held = new Promise<void>((r) => (ready = r));
    const holder = db.transaction(async (tx) => {
      await hold(tx);
      ready();
      await gate;
    });
    await held;
    let done = false;
    const running = op().finally(() => (done = true));
    running.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 500));
    const finishedWhileHeld = done;
    release();
    await holder;
    await running.catch(() => undefined);
    return finishedWhileHeld;
  };

  it('phiếu thu / hủy phiếu chờ khóa nợ khách; thu nợ cấn tay chờ khóa hàng hóa đơn; hủy chờ khóa hàng phiếu', async () => {
    const customerId = await newCustomer('CC-K4');
    const invoiceId = await newInvoice(customerId, '40000');
    // 1. khóa nợ khách + chi nhánh
    expect(
      await waitsFor(
        (tx) => lockPartyBranch(tx, 'customer', customerId, sg),
        () => receipt(customerId, '1000'),
      ),
      'phiếu thu phải chờ khóa nợ khách',
    ).toBe(false);
    // 2. khóa hàng hóa đơn (cấn tay)
    expect(
      await waitsFor(
        async (tx) => {
          await tx.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).for('update');
        },
        () => receipt(customerId, '2000', [{ invoiceId, amount: '2000' }]),
      ),
      'cấn trừ phải chờ khóa hàng hóa đơn',
    ).toBe(false);
    // 3. hủy chờ khóa nợ khách, rồi chờ khóa hàng phiếu
    const made = await receipt(customerId, '3000');
    expect(
      await waitsFor(
        (tx) => lockPartyBranch(tx, 'customer', customerId, sg),
        () => cash.cancel(sg, made.id, 'thử khóa nợ'),
      ),
      'hủy phải chờ khóa nợ khách',
    ).toBe(false);
    const made2 = await receipt(customerId, '4000');
    expect(
      await waitsFor(
        async (tx) => {
          await tx.select().from(schema.cashTransactions).where(eq(schema.cashTransactions.id, made2.id)).for('update');
        },
        () => cash.cancel(sg, made2.id, 'thử khóa hàng phiếu'),
      ),
      'hủy phải chờ khóa hàng phiếu',
    ).toBe(false);
    expect((await new ReconciliationService().run(db)).ok).toBe(true);
  }, 120_000);

  const sheetOf = (codes: string[]) => ({
    headers: ['ma phieu', 'thoi gian', 'loai thu chi', 'nguoi nop/nhan', 'gia tri'],
    rows: codes.map((code, i) => ({
      row: i + 2,
      values: {
        'ma phieu': code,
        'thoi gian': '03/11/2026 09:00',
        'loai thu chi': 'Phiếu thu Tiền khách trả',
        'nguoi nop/nhan': null,
        'gia tri': 1000,
      },
    })),
  });
  const runImport = (accountId: string, codes: string[]) =>
    db.transaction((tx) =>
      importCashTransactions(tx, sheetOf(codes), {
        userId: manager.id,
        branchId: sg,
        accountId,
        ref: { id: crypto.randomUUID(), code: 'IMP-TEST' },
      }),
    );

  it('nhập Sổ quỹ chờ khóa dòng quỹ (không chen được với người đang lập phiếu vào quỹ đó)', async () => {
    const [acc] = await db
      .insert(schema.cashAccounts)
      .values({ name: 'Quỹ nhập thử', type: 'cash', branchId: sg })
      .returning();
    const finishedWhileHeld = await waitsFor(
      async (tx) => {
        // người lập phiếu giữ khóa chia sẻ trên dòng quỹ
        await tx.select().from(schema.cashAccounts).where(eq(schema.cashAccounts.id, acc!.id)).for('share');
      },
      () => runImport(acc!.id, ['TT-C2-1']),
    );
    expect(finishedWhileHeld, 'nhập phải chờ khóa dòng quỹ').toBe(false);
  }, 120_000);

  it('nhập Sổ quỹ không kẹt khóa (deadlock) với người đang lấy mã phiếu cùng lúc', async () => {
    const [acc] = await db
      .insert(schema.cashAccounts)
      .values({ name: 'Quỹ kẹt khóa', type: 'cash', branchId: sg })
      .returning();
    const [seq] = await db.select().from(schema.codeSequences).where(eq(schema.codeSequences.prefix, 'TT'));
    const code = `TT${String(seq!.nextValue).padStart(6, '0')}`;
    // Y mô phỏng người lập phiếu: giữ dòng bộ đếm TT, rồi ghi đúng mã sắp cấp (trùng mã nằm trong file đang nhập)
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let ready!: () => void;
    const held = new Promise<void>((r) => (ready = r));
    const creator = db.transaction(async (tx) => {
      await tx.execute(sql`update code_sequences set updated_at = now() where prefix = 'TT'`);
      ready();
      await gate;
      // danh mục không ghi công nợ để đối soát không coi là phiếu thiếu bút toán
      const [other] = await tx.select().from(schema.cashCategories).where(eq(schema.cashCategories.code, 'other_in'));
      await tx.insert(schema.cashTransactions).values({
        code,
        branchId: sg,
        direction: 'in',
        amount: '1000',
        categoryId: other!.id,
        accountId: cashSg,
        occurredAt: new Date(),
        status: 'completed',
      });
    });
    await held;
    const importing = runImport(acc!.id, [code]);
    const settled = importing.then(
      () => 'ok',
      (e: unknown) => {
        // lỗi từ Drizzle bọc lỗi gốc của pg trong `cause` (mã 40P01 = deadlock_detected)
        const cause = (e as { cause?: { code?: string; message?: string } }).cause;
        return `${String(e)} ${cause?.code ?? ''} ${cause?.message ?? ''}`;
      },
    );
    await new Promise((r) => setTimeout(r, 500));
    release();
    // Sau khi sửa: nhập nâng bộ đếm TRƯỚC khi ghi nên chỉ chờ; người lập phiếu không bao giờ bị kẹt khóa
    await creator;
    const outcome = await settled;
    expect(outcome).not.toMatch(/deadlock|40P01/i);
    expect((await new ReconciliationService().run(db)).ok).toBe(true);
  }, 120_000);
});
