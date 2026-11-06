/**
 * Dữ liệu MẪU cho dev (hàng hóa, tồn đầu, giá 7 bảng giá × 2 chi nhánh). Chạy: `pnpm db:seed:demo` (trong apps/api)
 * SAU `pnpm db:migrate` và `pnpm db:seed`. Chạy lại an toàn. Từ chối chạy ở production.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Database } from './database.module.js';
import * as schema from './schema/index.js';
import { runDemoSeed } from './seed/demo.js';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'Thiếu biến môi trường DATABASE_URL (xem apps/api/.env.example)',
  );
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db: Database = drizzle({ client: pool, schema, casing: 'snake_case' });

try {
  const r = await runDemoSeed(db);
  console.log(
    `Hàng hóa mẫu     +${r.products}${r.products === 0 ? ' (đã có)' : ''}`,
  );
  console.log(`Combo mẫu        +${r.combos}`);
  console.log(`Nhà cung cấp mẫu +${r.suppliers}`);
  console.log(`Tồn đầu          +${r.openingMovements} dòng`);
} finally {
  await pool.end();
}
