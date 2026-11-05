import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeSheet, type CellValue } from '../../common/excel.js';
import type { AuthUser } from '../../common/auth-user.js';
import type { Database } from '../../db/database.module.js';
import * as schema from '../../db/schema/index.js';
import { runSeed } from '../../db/seed/index.js';
import { AuditService } from '../audit/audit.service.js';
import { BranchAccessService } from '../branches/branch-access.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { ReconciliationService } from '../reconciliation/reconciliation.service.js';
import { ImportsService } from './imports.service.js';

/**
 * Chạy trên PostgreSQL THẬT với nhiều kết nối (PGlite chỉ có một kết nối nên không tái hiện được bế tắc/đua).
 * Bỏ qua nếu không đặt PG_TEST_URL. Cách chạy:
 *   1. Tạo CSDL tạm rỗng (vd `createdb kiot_conc`) và áp dụng migration: DATABASE_URL=... pnpm db:migrate
 *   2. PG_TEST_URL=postgres://.../kiot_conc pnpm --filter @kiot/api exec vitest run imports-concurrency
 * Test GHI vào CSDL đó (seed nền + hàng thử) nên TUYỆT ĐỐI không trỏ vào CSDL thật.
 */
const URL = process.env.PG_TEST_URL;

const HEADERS = ['Mã hàng', 'Tên hàng', 'Giá vốn', 'Tồn kho'];
const xlsx = (rows: CellValue[][]) =>
  writeSheet(
    'Sheet1',
    HEADERS.map((header) => ({ header })),
    rows,
  );

describe.skipIf(!URL)('Import thêm: đồng thời trên PostgreSQL thật', () => {
  let pool: Pool;
  let db: Database;
  let svc: ImportsService;
  let inv: InventoryService;
  let manager: AuthUser;
  let sg: string;
  const PRODUCT_COUNT = 25;
  const codes = Array.from(
    { length: PRODUCT_COUNT },
    (_, i) => `CC${String(i).padStart(3, '0')}`,
  );

  const runFile = async (
    rows: CellValue[][],
    extra: { allowDuplicate?: boolean } = {},
  ) => {
    const buffer = await xlsx(rows);
    return svc.run(
      manager,
      'products',
      { originalname: 'nhap.xlsx', size: buffer.length, buffer },
      { dryRun: false, branchId: sg, mode: 'add', ...extra },
    );
  };

  const onHand = async (code: string) => {
    const [r] = await db
      .select({ onHand: schema.stocks.onHand })
      .from(schema.stocks)
      .innerJoin(
        schema.products,
        eq(schema.products.id, schema.stocks.productId),
      )
      .where(
        and(eq(schema.products.code, code), eq(schema.stocks.branchId, sg)),
      );
    return Number(r?.onHand ?? 0);
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL, max: 12 });
    db = drizzle({ client: pool, schema, casing: 'snake_case' }) as Database;
    // Bảo vệ: chỉ chạy trên CSDL còn trống (chưa có người dùng/hàng hóa nào)
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
    inv = new InventoryService(db);
    svc = new ImportsService(
      db,
      new AuditService(),
      new BranchAccessService(db),
      inv,
    );
    // Hàng thử, mỗi hàng tồn đầu 1000
    await runFile(codes.map((c) => [c, `Hàng ${c}`, 100, 1000]));
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('nhiều lần Import thêm đồng thời với cùng tập mã theo thứ tự NGƯỢC nhau: không bế tắc, tồn đúng tổng', async () => {
    const ROUNDS = 6;
    const before = await Promise.all(codes.map(onHand));
    const jobs: Promise<unknown>[] = [];
    for (let r = 0; r < ROUNDS; r++) {
      const forward = codes.map((c) => [c, null, null, 1 + r]);
      const backward = [...forward].reverse().map((x) => [...x]);
      // đổi số lượng để mỗi file có nội dung (băm) khác nhau
      jobs.push(runFile(forward as CellValue[][]));
      jobs.push(
        runFile(
          backward.map((x) => [x[0], null, null, 100 + r]) as CellValue[][],
        ),
      );
    }
    const results = await Promise.allSettled(jobs);
    const failed = results.filter((x) => x.status === 'rejected');
    expect(
      failed.map((f) => String((f as PromiseRejectedResult).reason)),
    ).toEqual([]);
    for (const r of results) {
      expect(
        (r as PromiseFulfilledResult<{ status: string }>).value.status,
      ).toBe('completed');
    }
    const added = Array.from(
      { length: ROUNDS },
      (_, r) => 1 + r + (100 + r),
    ).reduce((a, b) => a + b, 0);
    const after = await Promise.all(codes.map(onHand));
    after.forEach((v, i) => expect(v - before[i]!).toBe(added));
  }, 120_000);

  it('cùng một file gửi đồng thời 8 lần: đúng MỘT lần được cộng tồn, các lần còn lại 409 và hoàn tác', async () => {
    const before = await onHand(codes[0]!);
    const buffer = await xlsx([[codes[0]!, null, null, 7]]);
    const send = () =>
      svc.run(
        manager,
        'products',
        { originalname: 'cung-mot-file.xlsx', size: buffer.length, buffer },
        { dryRun: false, branchId: sg, mode: 'add' },
      );
    const results = await Promise.allSettled(Array.from({ length: 8 }, send));
    const ok = results.filter((r) => r.status === 'fulfilled');
    const dup = results.filter(
      (r) =>
        r.status === 'rejected' &&
        (r.reason as { code?: string }).code === 'IMPORT_DUPLICATE_FILE',
    );
    expect(ok).toHaveLength(1);
    expect(dup).toHaveLength(7);
    expect((await onHand(codes[0]!)) - before).toBe(7);
  }, 120_000);

  it('trừ tồn đồng thời không bao giờ làm tồn âm; sổ cái vẫn khớp số tồn', async () => {
    const code = codes[1]!;
    const have = await onHand(code);
    // 10 lần trừ, mỗi lần (have/4) → chỉ tối đa 4 lần thành công
    const each = Math.floor(have / 4);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, async (_, i) => {
        const r = await runFile([[code, null, null, -each - (i % 2)]]);
        if (r.status !== 'completed') throw new Error('failed');
        return r;
      }),
    );
    const left = await onHand(code);
    expect(left).toBeGreaterThanOrEqual(0);
    const okCount = results.filter((r) => r.status === 'fulfilled').length;
    expect(okCount).toBeLessThanOrEqual(4);
    expect(okCount).toBeGreaterThanOrEqual(1);
    const report = await new ReconciliationService().run(db);
    expect(report.ok).toBe(true);
    await db.execute(sql`select 1`);
  }, 120_000);
});
