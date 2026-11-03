/**
 * Dữ liệu khởi tạo. Chạy: `pnpm db:seed` (trong apps/api) sau `pnpm db:migrate`.
 * Chạy lại nhiều lần an toàn: chỉ thêm khi chưa có, KHÔNG ghi đè cấu hình Quản lý đã chỉnh.
 *
 * Hiện có: quyền mặc định của các vai trò. (Sẽ bổ sung: bảng giá, chi nhánh, tài khoản chủ,
 * danh mục thu chi, quỹ tiền mặt, bộ đếm mã chứng từ.)
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { PermissionsService } from '../modules/authorization/permissions.service.js';
import type { Database } from './database.module.js';
import * as schema from './schema/index.js';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'Thiếu biến môi trường DATABASE_URL (xem apps/api/.env.example)',
  );
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db: Database = drizzle({ client: pool, schema, casing: 'snake_case' });

try {
  const permissions = new PermissionsService(db);
  const inserted = await permissions.seedDefaultsIfEmpty();
  console.log(
    inserted > 0
      ? `Quyền mặc định: đã thêm ${inserted} dòng cho các vai trò.`
      : 'Quyền mặc định: bỏ qua (bảng role_permissions đã có dữ liệu).',
  );
} finally {
  await pool.end();
}
