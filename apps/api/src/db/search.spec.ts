import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { and, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { customers, products } from './schema/index.js';
import { partySearchExpr, productSearchExpr } from './schema/_search.js';
import { escapeLike, searchWhere } from './search.js';

/**
 * Chạy migration thật vào PostgreSQL trong bộ nhớ (PGlite, có unaccent + pg_trgm) rồi kiểm tra
 * tìm kiếm tiếng Việt. Không cần Docker.
 */
describe('tìm kiếm không dấu', () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle>;

  const findProducts = async (q: string) =>
    (
      await db
        .select({ code: products.code })
        .from(products)
        .where(and(searchWhere(productSearchExpr(products), q)))
        .orderBy(products.code)
    ).map((r) => r.code);

  const findCustomers = async (q: string) =>
    (
      await db
        .select({ code: customers.code })
        .from(customers)
        .where(searchWhere(partySearchExpr(customers), q))
        .orderBy(customers.code)
    ).map((r) => r.code);

  beforeAll(async () => {
    client = new PGlite({ extensions: { unaccent, pg_trgm } });
    const dir = resolve('drizzle');
    const files = readdirSync(dir)
      .filter((f) => /^\d+_.*\.sql$/.test(f))
      .sort();
    for (const f of files)
      await client.exec(readFileSync(resolve(dir, f), 'utf8'));
    db = drizzle({ client, casing: 'snake_case' });

    await client.exec(`
      INSERT INTO products (code, name) VALUES
        ('QKBSP',  'Quạt kẹp bàn Super MST-A1'),
        ('DLXS60', 'Đèn lồng điện 60#'),
        ('YAGDF',  'Chảo inox vân nổi cán gỗ 18cm'),
        ('SALE50', 'Giảm 50% Ly giữ nhiệt 700ml');
      INSERT INTO customers (code, name, phone) VALUES
        ('KH000001', 'Cửa hàng Hồng Phấn', '0900000001'),
        ('KH000002', 'Siêu thị Bé Yêu', '0900000002'),
        ('KH000003', 'Đại lý Ánh Dương', NULL);
    `);
  });

  afterAll(async () => {
    await client.close();
  });

  it('gõ không dấu vẫn ra hàng có dấu', async () => {
    expect(await findProducts('quat kep')).toEqual(['QKBSP']);
    expect(await findProducts('den long')).toEqual(['DLXS60']);
    expect(await findProducts('chao inox')).toEqual(['YAGDF']);
  });

  it('gõ có dấu và chữ Đ/đ', async () => {
    expect(await findProducts('Đèn lồng')).toEqual(['DLXS60']);
    expect(await findProducts('đèn')).toEqual(['DLXS60']);
    expect(await findProducts('DEN')).toEqual(['DLXS60']);
  });

  it('không phân biệt hoa thường và tìm theo mã', async () => {
    expect(await findProducts('qkbsp')).toEqual(['QKBSP']);
    expect(await findProducts('QuAt')).toEqual(['QKBSP']);
  });

  it('nhiều từ: mọi từ đều phải có, thứ tự tùy ý', async () => {
    expect(await findProducts('kep quat')).toEqual(['QKBSP']);
    expect(await findProducts('quat chao')).toEqual([]);
  });

  it('khớp một phần giữa chuỗi', async () => {
    expect(await findProducts('uper')).toEqual(['QKBSP']);
  });

  it('ký tự đặc biệt của LIKE được hiểu theo nghĩa đen', async () => {
    expect(await findProducts('50%')).toEqual(['SALE50']);
    expect(await findProducts('%')).toEqual(['SALE50']);
    expect(await findProducts('_')).toEqual([]);
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
  });

  it('từ khóa rỗng thì không lọc', () => {
    expect(searchWhere(productSearchExpr(products), '')).toBeUndefined();
    expect(searchWhere(productSearchExpr(products), '   ')).toBeUndefined();
    expect(searchWhere(productSearchExpr(products), undefined)).toBeUndefined();
  });

  it('khách hàng: tìm theo tên không dấu, mã và số điện thoại; chịu được phone NULL', async () => {
    expect(await findCustomers('hong phan')).toEqual(['KH000001']);
    expect(await findCustomers('sieu thi be yeu')).toEqual(['KH000002']);
    expect(await findCustomers('0900000002')).toEqual(['KH000002']);
    expect(await findCustomers('kh000003')).toEqual(['KH000003']);
    expect(await findCustomers('anh duong')).toEqual(['KH000003']);
  });

  it('chỉ mục GIN trigram thật sự được dùng (biểu thức truy vấn khớp biểu thức chỉ mục)', async () => {
    await client.exec('SET enable_seqscan = off');
    const plan = await client.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT 1 FROM products WHERE f_search_text(code || ' ' || name) LIKE '%quat%'`,
    );
    await client.exec('RESET enable_seqscan');
    const text = plan.rows.map((r) => r['QUERY PLAN']).join('\n');
    expect(text).toContain('products_search_trgm');

    await client.exec('SET enable_seqscan = off');
    const plan2 = await client.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT 1 FROM customers WHERE f_search_text(code || ' ' || name || ' ' || coalesce(phone, '')) LIKE '%hong%'`,
    );
    await client.exec('RESET enable_seqscan');
    expect(plan2.rows.map((r) => r['QUERY PLAN']).join('\n')).toContain(
      'customers_search_trgm',
    );
  });

  it('f_search_text bỏ dấu và hạ chữ thường', async () => {
    const r = await db.execute(
      sql`SELECT f_search_text('Đèn Lồng ƯU ĐÃI') AS v`,
    );
    expect((r.rows[0] as { v: string }).v).toBe('den long uu dai');
  });
});
