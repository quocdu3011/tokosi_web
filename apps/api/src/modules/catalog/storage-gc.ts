/**
 * Dọn file ảnh mồ côi trên kho file. Chạy: `pnpm --filter @kiot/api storage:gc` (chỉ liệt kê);
 * thêm `--apply` để xóa thật; `--older-than-hours=N` đổi ngưỡng tuổi file (mặc định 24 giờ).
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { loadConfig } from '../../config/app-config.js';
import { buildPoolConfig, type Database } from '../../db/database.module.js';
import * as schema from '../../db/schema/index.js';
import { S3FileStorage } from '../files/file-storage.js';
import { OrphanImagesService } from './orphan-images.service.js';

const storage = loadConfig().storage;
if (!storage) throw new Error('Chưa cấu hình kho file (S3_*) trong .env');

const apply = process.argv.includes('--apply');
const hours = Number(
  process.argv
    .find((a) => a.startsWith('--older-than-hours='))
    ?.split('=')[1] ?? 24,
);
if (!Number.isFinite(hours) || hours < 1) {
  throw new Error('--older-than-hours phải là số >= 1');
}

const pool = new Pool(buildPoolConfig());
const db: Database = drizzle({ client: pool, schema, casing: 'snake_case' });
try {
  const svc = new OrphanImagesService(db, new S3FileStorage(storage));
  const orphans = await svc.find(hours * 3600 * 1000);
  console.log(
    `File mồ côi (không có dòng product_images, cũ hơn ${hours} giờ): ${orphans.length}`,
  );
  for (const k of orphans.slice(0, 20)) console.log(`  ${k}`);
  if (orphans.length > 20)
    console.log(`  … và ${orphans.length - 20} file nữa`);
  if (!apply) {
    console.log(
      orphans.length
        ? '\nChạy lại với --apply để xóa.'
        : '\nKhông có gì cần dọn.',
    );
  } else if (orphans.length) {
    const r = await svc.remove(orphans);
    console.log(`\nĐã xóa ${r.deleted}, lỗi ${r.failed}.`);
    process.exitCode = r.failed ? 1 : 0;
  }
} finally {
  await pool.end();
}
