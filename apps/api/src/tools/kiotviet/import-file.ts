/**
 * Nhập file hàng hóa (.xlsx, vd do `kiotviet:pull` tạo) bằng ĐÚNG `ImportsService` của API — cùng kiểm tra, cùng ghi tồn
 * qua InventoryService, cùng nhật ký thao tác và chặn nhập trùng file — nhưng chạy từ dòng lệnh, không qua HTTP.
 * Dùng khi chưa đăng nhập giao diện được (vd tài khoản còn bị bắt đổi mật khẩu). Chạy trên CSDL của `DATABASE_URL`.
 *
 * Mặc định chỉ CHẠY THỬ (hoàn tác, không ghi gì). Thêm `--apply` để ghi thật.
 *
 *   pnpm --filter @kiot/api kiotviet:import -- --file D:\tokosi-data\kiotviet-api-hang-hoa.xlsx --branch HN [--user quanly] [--apply]
 *
 * Chế độ "thêm" (cộng tồn): chạy lại cùng file bị từ chối (409). Nhật ký ghi theo người dùng `--user` (mặc định quanly).
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { UserRole } from '@kiot/shared';
import { requestContext } from '../../common/request-context.js';
import { buildPoolConfig, type Database } from '../../db/database.module.js';
import * as schema from '../../db/schema/index.js';
import { AuditService } from '../../modules/audit/audit.service.js';
import { BranchAccessService } from '../../modules/branches/branch-access.service.js';
import { ImportsService } from '../../modules/imports/imports.service.js';
import { InventoryService } from '../../modules/inventory/inventory.service.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const fileArg = arg('file');
const branchCode = arg('branch');
const username = arg('user') ?? 'quanly';
const apply = process.argv.includes('--apply');
if (!fileArg || !branchCode) {
  console.error('Cần --file <đường dẫn .xlsx> và --branch <mã chi nhánh, vd HN>');
  process.exit(2);
}

const pool = new Pool(buildPoolConfig());
const db: Database = drizzle({
  client: pool,
  schema,
  casing: 'snake_case',
});

try {
  const [user] = await db
    .select({ id: schema.users.id, role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.username, username));
  if (!user) throw new Error(`Không có người dùng "${username}"`);
  const [branch] = await db
    .select({ id: schema.branches.id, name: schema.branches.name })
    .from(schema.branches)
    .where(eq(schema.branches.code, branchCode.toUpperCase()));
  if (!branch) throw new Error(`Không có chi nhánh mã "${branchCode}"`);

  const path = resolve(process.env.INIT_CWD ?? process.cwd(), fileArg);
  const buffer = readFileSync(path);
  const service = new ImportsService(
    db,
    new AuditService(),
    new BranchAccessService(db),
    new InventoryService(db),
  );

  console.log(
    `${apply ? 'NHẬP THẬT' : 'CHẠY THỬ'} ${basename(path)} → chi nhánh ${branch.name}, người dùng ${username}`,
  );
  const job = await requestContext.run(
    { requestId: randomUUID(), userId: user.id, branchId: branch.id },
    () =>
      service.run(
        { id: user.id, role: user.role as UserRole },
        'products',
        { originalname: basename(path), size: buffer.length, buffer },
        { dryRun: !apply, branchId: branch.id, mode: 'add' },
      ),
  );

  console.log(
    `Trạng thái: ${job.status} | tổng ${job.total} | tạo mới ${job.created} | cập nhật ${job.updated} | lỗi ${job.failed}`,
  );
  const by = new Map<string, number>();
  for (const e of job.errors)
    by.set(`${e.field}: ${e.message}`, (by.get(`${e.field}: ${e.message}`) ?? 0) + 1);
  for (const [k, n] of [...by].slice(0, 10)) console.log(`  ${n} × ${k}`);
  process.exitCode = job.status === 'completed' ? 0 : 1;
} finally {
  await pool.end();
}
