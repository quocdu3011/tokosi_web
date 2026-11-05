import type { PGlite } from '@electric-sql/pglite';
import type {
  DynamicModule,
  INestApplication,
  ModuleMetadata,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { UserRole } from '@kiot/shared';
import { configureApp } from '../app.setup.js';
import { hashPassword } from '../common/password.js';
import { ConfigModule } from '../config/app-config.js';
import { DB, type Database } from '../db/database.module.js';
import { branches, userBranches, users } from '../db/schema/index.js';
import { runSeed } from '../db/seed/index.js';
import { createTestDb } from '../db/test-db.js';
import { AuthModule } from '../modules/auth/auth.module.js';
import { AuthorizationModule } from '../modules/authorization/authorization.module.js';
import { BranchesModule } from '../modules/branches/branches.module.js';

export const ADMIN_PASSWORD = 'Mat-khau-quan-ly-thu-1';
export const USER_PASSWORD = 'Mat-khau-nhan-vien-1';

export interface HttpTestOptions {
  /** Các module cần thử (thêm vào bộ nền: cấu hình, CSDL, phân quyền, chi nhánh, xác thực). */
  imports: NonNullable<ModuleMetadata['imports']>;
  /** Thay một provider bằng bản giả: [token, giá trị]. */
  overrides?: Array<[unknown, unknown]>;
}

/**
 * Dựng ứng dụng NestJS thật (đủ ba guard, bộ lọc lỗi, ValidationPipe) trên PostgreSQL trong bộ nhớ đã chạy đủ
 * migration và seed — dùng cho test HTTP của từng module. Trả về các hàm tiện ích tạo người dùng và gọi API
 * với tư cách một người dùng.
 */
export async function createHttpTestApp(opts: HttpTestOptions) {
  process.env.JWT_ACCESS_SECRET ??=
    'http-test-secret-http-test-secret-0123456789';
  const { client, db } = await createTestDb();
  await runSeed(db, { adminPassword: ADMIN_PASSWORD });
  const branchRows = await db.select().from(branches);
  const sg = branchRows.find((b) => b.code === 'SG')!.id;
  const hn = branchRows.find((b) => b.code === 'HN')!.id;

  const dbModule: DynamicModule = {
    module: class TestDbModule {},
    global: true,
    providers: [{ provide: DB, useValue: db }],
    exports: [DB],
  };
  let builder = Test.createTestingModule({
    imports: [
      ConfigModule,
      dbModule,
      AuthorizationModule,
      BranchesModule,
      AuthModule,
      ...opts.imports,
    ],
  });
  for (const [token, value] of opts.overrides ?? []) {
    builder = builder.overrideProvider(token as never).useValue(value);
  }
  const moduleRef = await builder.compile();
  const app: INestApplication<App> = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  const http = () => request(app.getHttpServer());

  async function makeUser(
    username: string,
    role: UserRole,
    branchIds: string[] = [],
    defaultBranchId?: string,
  ) {
    const [u] = await db
      .insert(users)
      .values({
        code: `T-${username}`,
        username,
        fullName: username,
        passwordHash: await hashPassword(USER_PASSWORD),
        role,
        defaultBranchId: defaultBranchId ?? null,
      })
      .returning();
    if (branchIds.length > 0) {
      await db
        .insert(userBranches)
        .values(branchIds.map((branchId) => ({ userId: u!.id, branchId })));
    }
    return u!;
  }

  const tokens = new Map<string, string>();
  async function tokenOf(username: string): Promise<string> {
    const cached = tokens.get(username);
    if (cached) return cached;
    const password = username === 'quanly' ? ADMIN_PASSWORD : USER_PASSWORD;
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ username, password })
      .expect(200);
    // tài khoản Quản lý do seed tạo bị bắt đổi mật khẩu; đổi ngay để dùng được
    let token = res.body.accessToken as string;
    if (res.body.user.mustChangePassword) {
      const changed = await http()
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: password,
          newPassword: 'Mat-khau-quan-ly-moi-2',
        })
        .expect(200);
      token = changed.body.accessToken as string;
    }
    tokens.set(username, token);
    return token;
  }

  /** Gọi API với tư cách `username`; `branchId` (nếu có) gửi qua header X-Branch-Id. */
  async function as(username: string, branchId?: string) {
    const token = await tokenOf(username);
    const prep = (t: request.Test) => {
      t.set('Authorization', `Bearer ${token}`);
      if (branchId) t.set('X-Branch-Id', branchId);
      return t;
    };
    const base = '/api/v1';
    return {
      get: (url: string) => prep(http().get(base + url)),
      post: (url: string) => prep(http().post(base + url)),
      put: (url: string) => prep(http().put(base + url)),
      patch: (url: string) => prep(http().patch(base + url)),
      delete: (url: string) => prep(http().delete(base + url)),
    };
  }

  const userId = async (username: string) =>
    (await db.select().from(users).where(eq(users.username, username)))[0]!.id;

  async function close() {
    await app.close();
    await (client as PGlite).close();
  }

  return {
    app,
    db: db as Database,
    http,
    sg,
    hn,
    makeUser,
    as,
    userId,
    close,
  };
}
