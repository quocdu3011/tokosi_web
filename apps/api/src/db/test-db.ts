import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { drizzle } from 'drizzle-orm/pglite';
import type { Database } from './database.module.js';
import * as schema from './schema/index.js';

/**
 * CSDL PostgreSQL trong bộ nhớ (PGlite) đã chạy đủ migration thật — dùng cho test, không cần Docker.
 * Chạy test từ thư mục apps/api (đường dẫn `drizzle/` tính theo thư mục hiện hành).
 */
export async function createTestDb() {
  const client = new PGlite({ extensions: { unaccent, pg_trgm } });
  const dir = resolve('drizzle');
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
  for (const f of files)
    await client.exec(readFileSync(resolve(dir, f), 'utf8'));
  const pgliteDb = drizzle({ client, schema, casing: 'snake_case' });
  // PGlite và node-postgres dùng chung API truy vấn của Drizzle; ép kiểu để dùng cho các service.
  const db = pgliteDb as unknown as Database;
  return { client, db, pgliteDb };
}
