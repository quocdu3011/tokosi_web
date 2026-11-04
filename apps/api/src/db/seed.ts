/**
 * Dữ liệu khởi tạo. Chạy: `pnpm db:seed` (trong apps/api) sau `pnpm db:migrate`.
 * Chạy lại nhiều lần an toàn: chỉ thêm cái còn thiếu, KHÔNG ghi đè dữ liệu đã chỉnh.
 *
 * Biến môi trường (xem .env.example):
 *   SEED_ADMIN_USERNAME  tên đăng nhập Quản lý đầu tiên (mặc định `quanly`)
 *   SEED_ADMIN_PASSWORD  mật khẩu Quản lý đầu tiên; bỏ trống thì sinh ngẫu nhiên và ghi vào
 *                        file `.seed-admin-credentials.txt` (đã bị git bỏ qua) — KHÔNG in ra màn hình
 *   SEED_COMPANY_NAME    tên công ty trên mẫu in
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Database } from './database.module.js';
import * as schema from './schema/index.js';
import { runSeed } from './seed/index.js';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'Thiếu biến môi trường DATABASE_URL (xem apps/api/.env.example)',
  );
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db: Database = drizzle({ client: pool, schema, casing: 'snake_case' });

try {
  const result = await runSeed(db, {
    adminUsername: process.env.SEED_ADMIN_USERNAME || undefined,
    adminPassword: process.env.SEED_ADMIN_PASSWORD || undefined,
    companyName: process.env.SEED_COMPANY_NAME || undefined,
  });

  const labels: Record<string, string> = {
    branches: 'Chi nhánh',
    branchPartners: 'Khách/NCC nội bộ',
    priceBooks: 'Bảng giá',
    cashAccounts: 'Quỹ',
    cashCategories: 'Danh mục thu chi',
    codeSequences: 'Bộ đếm mã chứng từ',
    companyProfile: 'Thông tin công ty',
    rolePermissions: 'Quyền mặc định',
    adminUsers: 'Tài khoản Quản lý',
  };
  for (const [key, label] of Object.entries(labels)) {
    const added = result.report[key as keyof typeof result.report];
    console.log(`${label.padEnd(22)} ${added > 0 ? `+${added}` : 'đã có'}`);
  }

  if (result.adminUsername) {
    console.log(
      `\nĐã tạo tài khoản Quản lý "${result.adminUsername}" (bắt buộc đổi mật khẩu khi đăng nhập lần đầu).`,
    );
    if (result.generatedAdminPassword) {
      const file = resolve('.seed-admin-credentials.txt');
      writeFileSync(
        file,
        `Tài khoản: ${result.adminUsername}\nMật khẩu: ${result.generatedAdminPassword}\n` +
          'Đổi mật khẩu ngay sau lần đăng nhập đầu tiên rồi XÓA file này.\n',
        { encoding: 'utf8', mode: 0o600 },
      );
      console.log(`Mật khẩu được sinh ngẫu nhiên và ghi vào: ${file}`);
    }
  }
} finally {
  await pool.end();
}
