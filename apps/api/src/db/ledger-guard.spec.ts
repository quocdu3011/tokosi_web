import type { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import type { Database } from './database.module.js';
import {
  branches,
  cashAccounts,
  cashCategories,
  cashTransactions,
  debtLedger,
  products,
  stockMovements,
} from './schema/index.js';
import { runSeed } from './seed/index.js';
import { createTestDb } from './test-db.js';

/** Trigger sổ cái chỉ-thêm (migration 0012): CSDL phải từ chối, không phụ thuộc mã ứng dụng. */
describe('Sổ cái chỉ-thêm do CSDL ép (migration 0012)', () => {
  let client: PGlite;
  let db: Database;
  let branchId: string;
  let accountId: string;
  let categoryId: string;
  let productId: string;

  beforeAll(async () => {
    ({ client, db } = await createTestDb());
    await runSeed(db, { adminPassword: 'Mat-khau-thu-nghiem-1' });
    branchId = (await db.select().from(branches))[0]!.id;
    accountId = (await db.select().from(cashAccounts))[0]!.id;
    categoryId = (await db.select().from(cashCategories))[0]!.id;
    productId = (
      await db
        .insert(products)
        .values({ code: 'LG1', name: 'Hàng thử' })
        .returning()
    )[0]!.id;
  });
  afterAll(async () => {
    await client.close();
  });

  /** Lỗi thật của PostgreSQL nằm trong `cause` (Drizzle bọc lại). */
  const guardMessage = (e: unknown): string => {
    const cause = (e as { cause?: { message?: string; code?: string } }).cause;
    return `${cause?.code ?? ''} ${cause?.message ?? (e as Error).message}`;
  };
  async function expectRejected(run: () => Promise<unknown>, text: RegExp) {
    const err: unknown = await run().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err, 'câu lệnh lẽ ra phải bị CSDL từ chối').not.toBeNull();
    expect(guardMessage(err)).toMatch(text);
  }

  const newMovement = async () =>
    (
      await db
        .insert(stockMovements)
        .values({
          branchId,
          productId,
          qtyDelta: '5.000',
          refType: 'adjustment',
          occurredAt: new Date(),
        })
        .returning()
    )[0]!;
  const newDebt = async () =>
    (
      await db
        .insert(debtLedger)
        .values({
          branchId,
          partyType: 'customer',
          partyId: '00000000-0000-4000-8000-000000000001',
          entryType: 'adjustment',
          amount: '1000',
          occurredAt: new Date(),
        })
        .returning()
    )[0]!;
  let seq = 0;
  const newCash = async () =>
    (
      await db
        .insert(cashTransactions)
        .values({
          code: `PT-LG-${++seq}`,
          branchId,
          direction: 'in',
          amount: '50000',
          categoryId,
          accountId,
          occurredAt: new Date(),
          note: 'ghi chú đầu',
        })
        .returning()
    )[0]!;

  it('stock_movements: thêm được; sửa, xóa và TRUNCATE đều bị từ chối', async () => {
    const m = await newMovement();
    await expectRejected(
      () =>
        db
          .update(stockMovements)
          .set({ qtyDelta: '99.000' })
          .where(eq(stockMovements.id, m.id)),
      /LG001.*sổ cái chỉ-thêm.*update/s,
    );
    await expectRejected(
      () => db.delete(stockMovements).where(eq(stockMovements.id, m.id)),
      /LG001.*delete/s,
    );
    await expectRejected(
      () => db.execute('TRUNCATE TABLE stock_movements'),
      /LG001.*truncate/is,
    );
    const still = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.id, m.id));
    expect(still[0]?.qtyDelta).toBe('5.000');
  });

  it('debt_ledger: thêm được; sửa, xóa và TRUNCATE đều bị từ chối', async () => {
    const d = await newDebt();
    await expectRejected(
      () =>
        db
          .update(debtLedger)
          .set({ amount: '1' })
          .where(eq(debtLedger.id, d.id)),
      /LG001.*update/s,
    );
    await expectRejected(
      () => db.delete(debtLedger).where(eq(debtLedger.id, d.id)),
      /LG001.*delete/s,
    );
    await expectRejected(
      () => db.execute('TRUNCATE TABLE debt_ledger'),
      /LG001.*truncate/is,
    );
  });

  it('cash_transactions: không xóa, không đổi số tiền/quỹ/danh mục/thời điểm; được sửa ghi chú', async () => {
    const c = await newCash();
    await expectRejected(
      () => db.delete(cashTransactions).where(eq(cashTransactions.id, c.id)),
      /LG001.*delete/s,
    );
    await expectRejected(
      // CASCADE vì có khóa ngoại trỏ vào; không có CASCADE thì khóa ngoại đã chặn trước khi tới trigger
      () => db.execute('TRUNCATE TABLE cash_transactions CASCADE'),
      /LG001.*truncate/is,
    );
    for (const change of [
      { amount: '1' },
      { direction: 'out' as const },
      { occurredAt: new Date(2020, 0, 1) },
      { partyName: 'người khác' },
      { code: 'PT-DOI-MA' },
    ]) {
      await expectRejected(
        () =>
          db
            .update(cashTransactions)
            .set(change)
            .where(eq(cashTransactions.id, c.id)),
        /LG001.*chỉ được hủy hoặc sửa ghi chú/s,
      );
    }
    const edited = await db
      .update(cashTransactions)
      .set({ note: 'ghi chú đã sửa' })
      .where(eq(cashTransactions.id, c.id))
      .returning();
    expect(edited[0]).toMatchObject({
      note: 'ghi chú đã sửa',
      amount: '50000',
    });
  });

  it('cash_transactions: hủy phiếu (completed → cancelled) được phép; phiếu đã hủy không sửa được nữa, không "hồi sinh"', async () => {
    const c = await newCash();
    const cancelled = await db
      .update(cashTransactions)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: 'nhập nhầm',
      })
      .where(eq(cashTransactions.id, c.id))
      .returning();
    expect(cancelled[0]?.status).toBe('cancelled');

    await expectRejected(
      () =>
        db
          .update(cashTransactions)
          .set({ status: 'completed' })
          .where(eq(cashTransactions.id, c.id)),
      /LG001.*đã hủy/s,
    );
    await expectRejected(
      () =>
        db
          .update(cashTransactions)
          .set({ note: 'sửa sau khi hủy' })
          .where(eq(cashTransactions.id, c.id)),
      /LG001.*đã hủy/s,
    );
  });

  it('hủy kèm đổi số tiền trong cùng câu lệnh vẫn bị từ chối', async () => {
    const c = await newCash();
    await expectRejected(
      () =>
        db
          .update(cashTransactions)
          .set({ status: 'cancelled', amount: '1' })
          .where(eq(cashTransactions.id, c.id)),
      /LG001/,
    );
    const row = await db
      .select()
      .from(cashTransactions)
      .where(eq(cashTransactions.id, c.id));
    expect(row[0]).toMatchObject({ status: 'completed', amount: '50000' });
  });
});
