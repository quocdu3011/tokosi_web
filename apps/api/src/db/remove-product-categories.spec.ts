import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';

describe('Migration 0026 bỏ nhóm hàng', () => {
  it('xóa bảng và cột nhóm, giữ nguyên hàng hóa và liên kết tồn kho', async () => {
    const client = new PGlite({ extensions: { unaccent, pg_trgm } });
    try {
      const dir = resolve('drizzle');
      for (const file of readdirSync(dir)
        .filter((f) => /^\d+_.*\.sql$/.test(f))
        .sort()) {
        if (file.startsWith('0026_')) break;
        await client.exec(readFileSync(resolve(dir, file), 'utf8'));
      }
      await client.exec(`
        INSERT INTO branches (code, name) VALUES ('TEST', 'Chi nhánh thử');
        INSERT INTO categories (id, name) VALUES ('00000000-0000-4000-8000-000000000001', 'Nhóm cũ');
        INSERT INTO products (id, code, name, category_id)
          VALUES ('00000000-0000-4000-8000-000000000002', 'KEEP01', 'Hàng giữ lại', '00000000-0000-4000-8000-000000000001');
        INSERT INTO stocks (branch_id, product_id, on_hand, cost_price)
          SELECT id, '00000000-0000-4000-8000-000000000002', 12, 1500 FROM branches;
      `);
      const before = await client.query(
        'SELECT * FROM stocks ORDER BY branch_id',
      );
      expect(before.rows.length).toBeGreaterThan(0);
      await client.exec(
        readFileSync(resolve(dir, '0026_bo_nhom_hang.sql'), 'utf8'),
      );
      expect(
        (await client.query("SELECT to_regclass('public.categories') AS name"))
          .rows,
      ).toEqual([{ name: null }]);
      expect(
        (
          await client.query(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'category_id'",
          )
        ).rows,
      ).toEqual([]);
      expect(
        (await client.query('SELECT code, name FROM products')).rows,
      ).toEqual([{ code: 'KEEP01', name: 'Hàng giữ lại' }]);
      expect(
        (await client.query('SELECT * FROM stocks ORDER BY branch_id')).rows,
      ).toEqual(before.rows);
    } finally {
      await client.close();
    }
  });
});
