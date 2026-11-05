/**
 * Đối soát sổ cái với số liệu cache (tồn kho, công nợ nội bộ, quỹ). Chạy: `pnpm --filter @kiot/api db:reconcile`.
 * Chỉ ĐỌC. Thoát với mã 1 nếu có lệch, nên dùng được trong script kiểm tra hằng ngày.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { ReconciliationService } from '../modules/reconciliation/reconciliation.service.js';
import { buildPoolConfig, type Database } from './database.module.js';
import * as schema from './schema/index.js';

const pool = new Pool(buildPoolConfig());
const db: Database = drizzle({ client: pool, schema, casing: 'snake_case' });

try {
  const report = await new ReconciliationService().run(db);
  for (const c of report.checks) {
    console.log(
      `${c.issues === 0 ? 'OK  ' : 'LỆCH'} ${c.code} — ${c.description}${c.issues ? ` (${c.issues} bản ghi)` : ''}`,
    );
    for (const s of c.samples.slice(0, 5))
      console.log('     ', JSON.stringify(s));
  }
  console.log(
    report.ok
      ? '\nSổ cái khớp số liệu.'
      : '\nCÓ LỆCH: cần điều tra trước khi tiếp tục.',
  );
  process.exitCode = report.ok ? 0 : 1;
} finally {
  await pool.end();
}
