import type { PGlite } from '@electric-sql/pglite';
import {
  Controller,
  Get,
  Req,
  type DynamicModule,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Role } from '@kiot/shared';
import { type AppRequest, WorkingBranchId } from '../../common/auth-user.js';
import { hashPassword } from '../../common/password.js';
import { ConfigModule, loadConfig } from '../../config/app-config.js';
import { DB, type Database } from '../../db/database.module.js';
import {
  auditLogs,
  branches,
  refreshTokens,
  userBranches,
  users,
} from '../../db/schema/index.js';
import { runSeed } from '../../db/seed/index.js';
import { createTestDb } from '../../db/test-db.js';
import { configureApp } from '../../app.setup.js';
import { HealthModule } from '../../health/health.module.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { BranchesModule } from '../branches/branches.module.js';
import { RequireBranch } from '../branches/require-branch.decorator.js';
import { AuthModule } from './auth.module.js';
import { AuthService } from './auth.service.js';
import { TokenService, hashRefreshToken } from './token.service.js';

process.env.JWT_ACCESS_SECRET = 'http-test-secret-http-test-secret-0123456789';

const ADMIN_PW = 'Mat-khau-quan-ly-thu-1';
const USER_PW = 'Mat-khau-nhan-vien-1';

/** Endpoint thử nghiệm: cần quyền + chi nhánh làm việc, để kiểm tra cả ba guard cùng lúc. */
@Controller('probe')
class ProbeController {
  @Get('invoices')
  @RequirePermission('invoice.view')
  @RequireBranch()
  invoices(@WorkingBranchId() branchId: string, @Req() req: AppRequest) {
    return { branchId, scope: req.grants?.['invoice.view'] };
  }
}

describe('Xác thực qua HTTP (đủ AuthGuard + PermissionGuard + BranchContextGuard)', () => {
  let client: PGlite;
  let db: Database;
  let app: INestApplication<App>;
  let tokens: TokenService;
  let sg: string;
  let hn: string;

  beforeAll(async () => {
    ({ client, db } = await createTestDb());
    await runSeed(db, { adminPassword: ADMIN_PW });
    const rows = await db.select().from(branches);
    sg = rows.find((b) => b.code === 'SG')!.id;
    hn = rows.find((b) => b.code === 'HN')!.id;

    await makeUser('sale1', 'sales', { branchIds: [sg], defaultBranchId: sg });
    await makeUser('sale2', 'sales', { branchIds: [sg], defaultBranchId: sg });
    await makeUser('sale3', 'sales', { branchIds: [sg], defaultBranchId: sg });
    await makeUser('sale4', 'sales', { branchIds: [sg], defaultBranchId: sg });
    await makeUser('sale6', 'sales', { branchIds: [sg], defaultBranchId: sg });
    await makeUser('sale7', 'sales', { branchIds: [sg], defaultBranchId: sg });
    await makeUser('sale8', 'sales', { branchIds: [sg], defaultBranchId: sg });
    await makeUser('ketoan1', 'accountant', { branchIds: [sg, hn] });
    await makeUser('khoa1', 'sales', { branchIds: [sg], isActive: false });

    const dbModule: DynamicModule = {
      module: class TestDbModule {},
      global: true,
      providers: [{ provide: DB, useValue: db }],
      exports: [DB],
    };
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        dbModule,
        HealthModule,
        AuthorizationModule,
        BranchesModule,
        AuthModule,
      ],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    tokens = moduleRef.get(TokenService);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await client.close();
  });

  async function makeUser(
    username: string,
    role: Role,
    opts: {
      branchIds?: string[];
      defaultBranchId?: string;
      isActive?: boolean;
      mustChange?: boolean;
    } = {},
  ) {
    const [u] = await db
      .insert(users)
      .values({
        code: `T-${username}`,
        username,
        fullName: username,
        passwordHash: await hashPassword(USER_PW),
        role,
        isActive: opts.isActive ?? true,
        mustChangePassword: opts.mustChange ?? false,
        defaultBranchId: opts.defaultBranchId ?? null,
      })
      .returning();
    if (opts.branchIds?.length) {
      await db
        .insert(userBranches)
        .values(
          opts.branchIds.map((branchId) => ({ userId: u!.id, branchId })),
        );
    }
    return u!;
  }

  const http = () => request(app.getHttpServer());
  const login = (username: string, password: string) =>
    http().post('/api/v1/auth/login').send({ username, password });
  const refreshCookieOf = (res: request.Response): string | undefined =>
    (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) =>
      c.startsWith('refresh_token='),
    );
  const cookieHeader = (setCookie: string) => setCookie.split(';')[0]!;
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  async function loginOk(username: string, password = USER_PW) {
    const res = await login(username, password).expect(200);
    return {
      token: res.body.accessToken as string,
      cookie: cookieHeader(refreshCookieOf(res)!),
      body: res.body,
    };
  }
  const userId = async (username: string) =>
    (await db.select().from(users).where(eq(users.username, username)))[0]!.id;

  // ------------------------------------------------------------------ chưa đăng nhập / token xấu

  it('endpoint công khai (health) không cần token', async () => {
    await http().get('/api/v1/health').expect(200);
  });

  it('endpoint cần đăng nhập: thiếu token → 401 UNAUTHENTICATED', async () => {
    const res = await http().get('/api/v1/auth/me').expect(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    await http().get('/api/v1/roles').expect(401);
    await http().get('/api/v1/branches').expect(401);
  });

  it('token sai định dạng, sai khóa, thuật toán none, header sai → 401', async () => {
    for (const header of [
      'Bearer abc',
      'Bearer a.b.c',
      'Basic dXNlcjpwdw==',
      'Bearer',
      'abc',
    ]) {
      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', header)
        .expect(401);
    }
    const other = new TokenService(
      loadConfig({
        JWT_ACCESS_SECRET: 'mot-khoa-khac-hoan-toan-0123456789-abcdef',
      }),
    );
    const forged = await other.signAccessToken(await userId('sale1'));
    await http().get('/api/v1/auth/me').set(bearer(forged.token)).expect(401);
  });

  it('token hết hạn → 401 TOKEN_EXPIRED (để frontend biết phải refresh)', async () => {
    const expired = await tokens.signAccessToken(
      await userId('sale1'),
      new Date(Date.now() - 3600_000),
    );
    const res = await http()
      .get('/api/v1/auth/me')
      .set(bearer(expired.token))
      .expect(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  it('token hợp lệ nhưng người dùng không tồn tại → 401', async () => {
    const ghost = await tokens.signAccessToken(
      '00000000-0000-4000-8000-000000000001',
    );
    await http().get('/api/v1/auth/me').set(bearer(ghost.token)).expect(401);
  });

  // ------------------------------------------------------------------ đăng nhập

  it('đăng nhập đúng: trả access token + thông tin; refresh token chỉ nằm trong cookie httpOnly', async () => {
    const res = await login('sale1', USER_PW).expect(200);
    expect(res.body).toMatchObject({
      expiresIn: 900,
      user: { username: 'sale1', role: 'sales', mustChangePassword: false },
    });
    expect(res.body.accessToken.split('.')).toHaveLength(3);
    expect(JSON.stringify(res.body)).not.toMatch(
      /refresh|argon2|passwordHash/i,
    );

    const cookie = refreshCookieOf(res)!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).toMatch(/Expires=/i);
    expect(cookie).not.toMatch(/Secure/i); // chỉ bật ở production
  });

  it('thông tin trả về: quyền theo cấu hình hiện tại, chi nhánh được phép, chi nhánh mặc định', async () => {
    const sale = await loginOk('sale1');
    const perms = Object.fromEntries(
      sale.body.user.permissions.map((p: { code: string; scope: string }) => [
        p.code,
        p.scope,
      ]),
    );
    expect(perms['invoice.view']).toBe('own');
    expect(perms['product.view']).toBe('all');
    expect(perms['role.manage']).toBeUndefined();
    expect(sale.body.user.branches).toEqual([
      { id: sg, code: 'SG', name: 'Chi nhánh Sài Gòn' },
    ]);
    expect(sale.body.user.defaultBranchId).toBe(sg);

    const acc = await loginOk('ketoan1');
    expect(acc.body.user.branches.map((b: { code: string }) => b.code)).toEqual(
      ['HN', 'SG'],
    );
    expect(acc.body.user.defaultBranchId).toBeNull();
  });

  it('tên đăng nhập không phân biệt hoa thường và bỏ khoảng trắng hai đầu', async () => {
    await login('  SaLe1 ', USER_PW).expect(200);
  });

  it('sai mật khẩu, tài khoản không tồn tại, tài khoản bị khóa → cùng một thông báo 401', async () => {
    const wrongPw = await login('sale1', 'sai-mat-khau-xyz').expect(401);
    const unknown = await login('khong-ton-tai', USER_PW).expect(401);
    const locked = await login('khoa1', USER_PW).expect(401);
    for (const res of [wrongPw, unknown, locked]) {
      expect(res.body).toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'Sai tên đăng nhập hoặc mật khẩu',
      });
    }
  });

  it('thiếu hoặc sai kiểu dữ liệu → 400', async () => {
    await http().post('/api/v1/auth/login').send({}).expect(400);
    await http().post('/api/v1/auth/login').send({ username: 'a' }).expect(400);
    await http()
      .post('/api/v1/auth/login')
      .send({ username: 1, password: 2 })
      .expect(400);
    await http()
      .post('/api/v1/auth/login')
      .send({ username: 'a', password: 'b', thua: 1 })
      .expect(400);
  });

  it('đăng nhập sai quá 5 lần → 429 RATE_LIMITED, kể cả khi lần sau nhập đúng mật khẩu', async () => {
    for (let i = 0; i < 5; i++) await login('sale2', 'sai-sai-sai').expect(401);
    const blocked = await login('sale2', USER_PW).expect(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBe(
      blocked.body.details.retryAfterSeconds,
    );
    expect(blocked.body.details.retryAfterSeconds).toBeGreaterThan(0);
    // tài khoản khác cùng IP không bị ảnh hưởng
    await login('sale1', USER_PW).expect(200);
  }, 60_000);

  // ------------------------------------------------------------------ bắt buộc đổi mật khẩu

  it('tài khoản Quản lý mới (seed) bị bắt đổi mật khẩu; đổi xong mới dùng được hệ thống', async () => {
    const first = await loginOk('quanly', ADMIN_PW);
    expect(first.body.user.mustChangePassword).toBe(true);

    // chỉ /auth/me được phép; mọi thứ khác bị chặn
    await http().get('/api/v1/auth/me').set(bearer(first.token)).expect(200);
    const blocked = await http()
      .get('/api/v1/roles')
      .set(bearer(first.token))
      .expect(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await http().get('/api/v1/branches').set(bearer(first.token)).expect(403);

    // mật khẩu hiện tại sai
    const wrong = await http()
      .post('/api/v1/auth/change-password')
      .set(bearer(first.token))
      .send({
        currentPassword: 'sai-mat-khau-hien-tai',
        newPassword: 'Mat-khau-moi-rat-manh-1',
      })
      .expect(400);
    expect(wrong.body.details[0].field).toBe('currentPassword');

    // mật khẩu mới yếu / trùng cũ / chứa tên đăng nhập
    for (const weak of [
      'ngan',
      ADMIN_PW,
      'xxquanlyxxxxxxxx',
      'a'.repeat(200),
    ]) {
      await http()
        .post('/api/v1/auth/change-password')
        .set(bearer(first.token))
        .send({ currentPassword: ADMIN_PW, newPassword: weak })
        .expect(400);
    }

    const changed = await http()
      .post('/api/v1/auth/change-password')
      .set(bearer(first.token))
      .send({
        currentPassword: ADMIN_PW,
        newPassword: 'Mat-khau-moi-rat-manh-1',
      })
      .expect(200);
    expect(changed.body.user.mustChangePassword).toBe(false);
    const newToken = changed.body.accessToken as string;
    const newCookie = cookieHeader(refreshCookieOf(changed)!);

    // dùng được ngay với token mới
    await http().get('/api/v1/roles').set(bearer(newToken)).expect(200);
    // phiên cũ bị thu hồi, phiên mới dùng được
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', first.cookie)
      .expect(401);
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', newCookie)
      .expect(200);
    // mật khẩu cũ không còn đăng nhập được, mật khẩu mới thì có
    await login('quanly', ADMIN_PW).expect(401);
    await login('quanly', 'Mat-khau-moi-rat-manh-1').expect(200);
  }, 60_000);

  // ------------------------------------------------------------------ quyền và chi nhánh

  it('phân quyền: Sale không vào được màn hình phân quyền (403), Quản lý vào được (200)', async () => {
    const sale = await loginOk('sale1');
    const res = await http()
      .get('/api/v1/roles')
      .set(bearer(sale.token))
      .expect(403);
    expect(res.body).toMatchObject({
      code: 'FORBIDDEN',
      details: { permission: 'role.manage' },
    });

    const manager = await login('quanly', 'Mat-khau-moi-rat-manh-1').expect(
      200,
    );
    await http()
      .get('/api/v1/roles')
      .set(bearer(manager.body.accessToken))
      .expect(200);
  });

  it('GET /branches: nhân viên chỉ thấy chi nhánh được gán, Quản lý thấy cả hai', async () => {
    const sale = await loginOk('sale1');
    const mine = await http()
      .get('/api/v1/branches')
      .set(bearer(sale.token))
      .expect(200);
    expect(mine.body.map((b: { code: string }) => b.code)).toEqual(['SG']);

    const manager = await login('quanly', 'Mat-khau-moi-rat-manh-1').expect(
      200,
    );
    const all = await http()
      .get('/api/v1/branches')
      .set(bearer(manager.body.accessToken))
      .expect(200);
    expect(all.body.map((b: { code: string }) => b.code)).toEqual(['HN', 'SG']);
  });

  it('chi nhánh làm việc: mặc định theo người dùng, header hợp lệ, header sai/không được phép', async () => {
    const sale = await loginOk('sale1');
    // không header → chi nhánh mặc định; phạm vi quyền "own" được gắn vào request
    const def = await http()
      .get('/api/v1/probe/invoices')
      .set(bearer(sale.token))
      .expect(200);
    expect(def.body).toEqual({ branchId: sg, scope: 'own' });
    // chi nhánh không được gán
    const denied = await http()
      .get('/api/v1/probe/invoices')
      .set(bearer(sale.token))
      .set('X-Branch-Id', hn)
      .expect(403);
    expect(denied.body.code).toBe('BRANCH_FORBIDDEN');
    // header không phải UUID
    await http()
      .get('/api/v1/probe/invoices')
      .set(bearer(sale.token))
      .set('X-Branch-Id', 'khong-phai-uuid')
      .expect(400);

    // Kế toán có cả hai chi nhánh, không có mặc định: phải chọn
    const acc = await loginOk('ketoan1');
    const required = await http()
      .get('/api/v1/probe/invoices')
      .set(bearer(acc.token))
      .expect(400);
    expect(required.body.code).toBe('BRANCH_REQUIRED');
    const hnRes = await http()
      .get('/api/v1/probe/invoices')
      .set(bearer(acc.token))
      .set('X-Branch-Id', hn)
      .expect(200);
    expect(hnRes.body).toMatchObject({ branchId: hn, scope: 'all' });
  });

  it('đổi vai trò / khóa tài khoản có hiệu lực ngay, không phải chờ token hết hạn', async () => {
    const victim = await makeUser('sale5', 'sales', {
      branchIds: [sg],
      defaultBranchId: sg,
    });
    const s = await loginOk('sale5');
    await http().get('/api/v1/roles').set(bearer(s.token)).expect(403);

    await db
      .update(users)
      .set({ role: 'manager' })
      .where(eq(users.id, victim.id));
    await http().get('/api/v1/roles').set(bearer(s.token)).expect(200); // cùng token, vai trò mới

    await db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, victim.id));
    await http().get('/api/v1/auth/me').set(bearer(s.token)).expect(401);
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', s.cookie)
      .expect(401);
    await login('sale5', USER_PW).expect(401);
  });

  // ------------------------------------------------------------------ refresh / logout

  it('refresh: xoay vòng token, cookie mới, token cũ bị từ chối', async () => {
    const s = await loginOk('sale3');
    const r1 = await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', s.cookie)
      .expect(200);
    expect(r1.body.accessToken.split('.')).toHaveLength(3);
    expect(r1.body.expiresIn).toBe(900);
    const nextCookie = refreshCookieOf(r1)!;
    expect(nextCookie).not.toBe(s.cookie);
    expect(JSON.stringify(r1.body)).not.toMatch(/refresh/i);

    // token cũ vừa bị thu hồi → từ chối (và xóa cookie), nhưng KHÔNG đăng xuất mọi thiết bị (có thời gian ân hạn)
    const reuse = await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', s.cookie)
      .expect(401);
    expect(refreshCookieOf(reuse)).toMatch(/Expires=Thu, 01 Jan 1970/i);
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(nextCookie))
      .expect(200);
  });

  it('refresh: thiếu cookie, cookie rác → 401', async () => {
    await http().post('/api/v1/auth/refresh').expect(401);
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'refresh_token=rac-khong-co-that')
      .expect(401);
  });

  it('dùng lại refresh token đã thu hồi từ lâu (nghi bị đánh cắp) → thu hồi MỌI phiên của người dùng', async () => {
    const s = await loginOk('sale4');
    const device2 = await loginOk('sale4'); // thiết bị thứ hai
    const r1 = await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', s.cookie)
      .expect(200);
    const liveCookie = cookieHeader(refreshCookieOf(r1)!);

    // giả lập: token cũ đã bị thu hồi từ 1 phút trước
    const raw = s.cookie.split('=')[1]!;
    await db
      .update(refreshTokens)
      .set({
        revokedAt: new Date(Date.now() - 60_000),
        revokeReason: 'rotated',
      })
      .where(eq(refreshTokens.tokenHash, hashRefreshToken(raw)));

    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', s.cookie)
      .expect(401);
    // phiên đang sống của cùng người dùng (cả hai thiết bị) đều bị thu hồi
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', liveCookie)
      .expect(401);
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', device2.cookie)
      .expect(401);
  });

  it('đổi mật khẩu ở máy A: máy B dùng token cũ (đã thu hồi từ lâu) chỉ bị từ chối, KHÔNG làm mất phiên mới của máy A', async () => {
    const a = await loginOk('sale7');
    const b = await loginOk('sale7');
    const changed = await http()
      .post('/api/v1/auth/change-password')
      .set(bearer(a.token))
      .send({
        currentPassword: USER_PW,
        newPassword: 'Mat-khau-moi-rat-manh-7',
      })
      .expect(200);
    const aCookie = cookieHeader(refreshCookieOf(changed)!);

    // giả lập: 15 phút sau, máy B mới làm mới bằng token đã bị thu hồi từ lúc đổi mật khẩu
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date(Date.now() - 15 * 60_000) })
      .where(eq(refreshTokens.userId, await userId('sale7')));
    // (đặt lại: phiên mới của A vẫn còn sống)
    await db
      .update(refreshTokens)
      .set({ revokedAt: null, revokeReason: null })
      .where(
        eq(refreshTokens.tokenHash, hashRefreshToken(aCookie.split('=')[1]!)),
      );

    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', b.cookie)
      .expect(401);
    // phiên của máy A không bị thu hồi, và không có nhật ký báo động giả
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', aCookie)
      .expect(200);
    const logs = await db.select().from(auditLogs);
    const uid = await userId('sale7');
    expect(
      logs.some(
        (l) => l.action === 'auth.refresh_reuse_detected' && l.userId === uid,
      ),
    ).toBe(false);
    const reason = await db
      .select()
      .from(refreshTokens)
      .where(
        eq(refreshTokens.tokenHash, hashRefreshToken(b.cookie.split('=')[1]!)),
      );
    expect(reason[0]!.revokeReason).toBe('password_change');
  });

  it('đăng xuất rồi dùng lại cookie cũ (tab khác) → chỉ 401, không thu hồi các phiên khác', async () => {
    const a = await loginOk('sale8');
    const other = await loginOk('sale8');
    await http()
      .post('/api/v1/auth/logout')
      .set('Cookie', a.cookie)
      .expect(204);
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date(Date.now() - 60_000) })
      .where(
        eq(refreshTokens.tokenHash, hashRefreshToken(a.cookie.split('=')[1]!)),
      );
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', a.cookie)
      .expect(401);
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', other.cookie)
      .expect(200);
  });

  it('gửi song song nhiều lần đăng nhập sai không vượt được giới hạn (tối đa 5 lần bị băm)', async () => {
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        login('sale6', 'sai-sai-sai').then((r) => r.status),
      ),
    );
    expect(results.filter((s) => s === 401).length).toBeLessThanOrEqual(5);
    expect(results.filter((s) => s === 429).length).toBeGreaterThanOrEqual(25);
    await login('sale6', USER_PW).expect(429);
  }, 60_000);

  it('đổi mật khẩu: access token cấp TRƯỚC đó bị từ chối NGAY (không chờ 15 phút), token mới dùng được; ghi mốc password_changed_at', async () => {
    const u = await makeUser('pw1', 'sales', {
      branchIds: [sg],
      defaultBranchId: sg,
    });
    // token cấp từ 5 giây trước (thiết bị khác đang đăng nhập)
    const oldToken = (
      await tokens.signAccessToken(u.id, new Date(Date.now() - 5000))
    ).token;
    await http().get('/api/v1/auth/me').set(bearer(oldToken)).expect(200);

    const a = await loginOk('pw1');
    const changed = await http()
      .post('/api/v1/auth/change-password')
      .set(bearer(a.token))
      .send({
        currentPassword: USER_PW,
        newPassword: 'Mat-khau-hoan-toan-moi-1',
      })
      .expect(200);
    const rejected = await http()
      .get('/api/v1/auth/me')
      .set(bearer(oldToken))
      .expect(401);
    expect(rejected.body.code).toBe('UNAUTHENTICATED');
    await http()
      .get('/api/v1/auth/me')
      .set(bearer(changed.body.accessToken))
      .expect(200);
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(row!.passwordChangedAt).toBeInstanceOf(Date);
  });

  it('đổi mật khẩu là MỘT khối: lỗi giữa chừng thì mật khẩu KHÔNG đổi và phiên cũ KHÔNG bị thu hồi', async () => {
    const u = await makeUser('pw2', 'sales', {
      branchIds: [sg],
      defaultBranchId: sg,
    });
    const s = await loginOk('pw2');
    const spy = vi
      .spyOn(
        AuthService.prototype as unknown as {
          createSession: () => Promise<unknown>;
        },
        'createSession',
      )
      .mockRejectedValueOnce(new Error('lỗi giả lập khi tạo phiên mới'));
    try {
      await http()
        .post('/api/v1/auth/change-password')
        .set(bearer(s.token))
        .send({
          currentPassword: USER_PW,
          newPassword: 'Mat-khau-hoan-toan-moi-2',
        })
        .expect(500);
    } finally {
      spy.mockRestore();
    }

    await login('pw2', USER_PW).expect(200); // mật khẩu cũ vẫn dùng được
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', s.cookie)
      .expect(200); // phiên cũ chưa bị thu hồi
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(row!.passwordChangedAt).toBeNull();
  });

  it('đăng xuất: 204, xóa cookie, refresh token không dùng lại được; gọi lặp không lỗi', async () => {
    const s = await loginOk('sale1');
    const out = await http()
      .post('/api/v1/auth/logout')
      .set('Cookie', s.cookie)
      .expect(204);
    expect(refreshCookieOf(out)).toMatch(/Expires=Thu, 01 Jan 1970/i);
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', s.cookie)
      .expect(401);
    await http()
      .post('/api/v1/auth/logout')
      .set('Cookie', s.cookie)
      .expect(204);
    await http().post('/api/v1/auth/logout').expect(204);
  });

  it('CSDL chỉ lưu bản băm của refresh token, không lưu token thô', async () => {
    const s = await loginOk('sale1');
    const raw = s.cookie.split('=')[1]!;
    const rows = await db.select().from(refreshTokens);
    expect(rows.some((r) => r.tokenHash === raw)).toBe(false);
    expect(rows.some((r) => r.tokenHash === hashRefreshToken(raw))).toBe(true);
  });

  it('nhật ký: ghi đăng nhập thành công/thất bại; KHÔNG lưu tên gõ nhầm của tài khoản không tồn tại, không lưu mật khẩu', async () => {
    await login('ten-go-nham-co-the-la-mat-khau-123', 'mat-khau-bat-ky').expect(
      401,
    );
    await loginOk('sale1');
    const logs = await db.select().from(auditLogs);
    const dump = JSON.stringify(logs);
    expect(logs.some((l) => l.action === 'auth.login')).toBe(true);
    expect(logs.some((l) => l.action === 'auth.login_failed')).toBe(true);
    expect(logs.some((l) => l.action === 'auth.password_changed')).toBe(true);
    expect(dump).not.toContain('ten-go-nham-co-the-la-mat-khau-123');
    expect(dump).not.toContain('mat-khau-bat-ky');
    expect(dump).not.toContain(USER_PW);
    expect(dump).not.toContain(ADMIN_PW);
  });
});
