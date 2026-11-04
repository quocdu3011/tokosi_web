import type { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { nextDocumentCode } from './code-sequence.js';
import type { Database } from './database.module.js';
import { codeSequences } from './schema/index.js';
import { createTestDb } from './test-db.js';

describe('nextDocumentCode', () => {
  let client: PGlite;
  let db: Database;

  beforeAll(async () => {
    ({ client, db } = await createTestDb());
    await db.insert(codeSequences).values([
      { prefix: 'HD', nextValue: 16891, digits: 6 },
      { prefix: 'NV', nextValue: 1, digits: 4 },
    ]);
  });
  afterAll(async () => {
    await client.close();
  });

  it('cấp mã liên tiếp đúng định dạng theo số chữ số của tiền tố', async () => {
    expect(await nextDocumentCode(db, 'HD')).toBe('HD016891');
    expect(await nextDocumentCode(db, 'HD')).toBe('HD016892');
    expect(await nextDocumentCode(db, 'NV')).toBe('NV0001');
  });

  it('nhiều yêu cầu cùng lúc không bao giờ trùng mã', async () => {
    const codes = await Promise.all(
      Array.from({ length: 30 }, () => nextDocumentCode(db, 'HD')),
    );
    expect(new Set(codes).size).toBe(30);
    const nums = codes.map((c) => Number(c.slice(2))).sort((a, b) => a - b);
    expect(nums[29]! - nums[0]!).toBe(29); // liên tiếp, không hổng
  });

  it('rollback transaction thì số được trả lại (không hổng số)', async () => {
    const [before] = await db
      .select()
      .from(codeSequences)
      .where(eq(codeSequences.prefix, 'NV'));
    await expect(
      db.transaction(async (tx) => {
        await nextDocumentCode(tx, 'NV');
        throw new Error('hủy');
      }),
    ).rejects.toThrow('hủy');
    const [after] = await db
      .select()
      .from(codeSequences)
      .where(eq(codeSequences.prefix, 'NV'));
    expect(after?.nextValue).toBe(before?.nextValue);
  });

  it('tiền tố chưa khởi tạo thì báo lỗi rõ ràng', async () => {
    await expect(nextDocumentCode(db, 'ZZ')).rejects.toThrow(/ZZ/);
  });
});
