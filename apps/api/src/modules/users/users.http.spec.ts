import type { PGlite } from '@electric-sql/pglite';
import type { DynamicModule, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Role } from '@kiot/shared';
import { hashPassword } from '../../common/password.js';
import { ConfigModule } from '../../config/app-config.js';
import { DB, type Database } from '../../db/database.module.js';
import {
  auditLogs,
  branches,
  codeSequences,
  refreshTokens,
  userBranches,
  users,
} from '../../db/schema/index.js';
import { runSeed } from '../../db/seed/index.js';
import { createTestDb } from '../../db/test-db.js';
import { configureApp } from '../../app.setup.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { BranchesModule } from '../branches/branches.module.js';
import { UsersModule } from './users.module.js';
import { UsersService } from './users.service.js';

process.env.JWT_ACCESS_SECRET = 'http-test-secret-http-test-secret-0123456789';

const USER_PW = 'Mat-khau-nhan-vien-1';
const byText = (a: string, b: string) => a.localeCompare(b);

describe('Quản lý người dùng qua HTTP', () => {
  let client: PGlite;
  let db: Database;
  let app: INestApplication<App>;
  let service: UsersService;
  let sg: string;
  let hn: string;
  let adminToken: string;

  beforeAll(async () => {
    ({ client, db } = await createTestDb());
    await runSeed(db, { adminPassword: 'Mat-khau-quan-ly-thu-1' });
    const rows = await db.select().from(branches);
    sg = rows.find((b) => b.code === 'SG')!.id;
    hn = rows.find((b) => b.code === 'HN')!.id;

    await makeUser('quanly2', 'manager');
    await makeUser('sale1', 'sales', [sg]);

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
        AuthorizationModule,
        BranchesModule,
        AuthModule,
        UsersModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    service = moduleRef.get(UsersService);
    adminToken = (await login('quanly2', USER_PW).expect(200)).body.accessToken;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await client.close();
  });

  async function makeUser(
    username: string,
    role: Role,
    branchIds: string[] = [],
    mustChange = false,
  ) {
    const [u] = await db
      .insert(users)
      .values({
        code: `T-${username}`,
        username,
        fullName: username,
        passwordHash: await hashPassword(USER_PW),
        role,
        mustChangePassword: mustChange,
      })
      .returning();
    if (branchIds.length) {
      await db
        .insert(userBranches)
        .values(branchIds.map((branchId) => ({ userId: u!.id, branchId })));
    }
    return u!;
  }

  const http = () => request(app.getHttpServer());
  const login = (username: string, password: string) =>
    http().post('/api/v1/auth/login').send({ username, password });
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const asAdmin = {
    get: (url: string) => http().get(url).set(bearer(adminToken)),
    post: (url: string) => http().post(url).set(bearer(adminToken)),
    patch: (url: string) => http().patch(url).set(bearer(adminToken)),
    put: (url: string) => http().put(url).set(bearer(adminToken)),
  };
  const idOf = async (username: string) =>
    (await db.select().from(users).where(eq(users.username, username)))[0]!.id;

  // ------------------------------------------------------------------ quyền truy cập

  it('chưa đăng nhập → 401; vai trò không phải Quản lý → 403 FORBIDDEN', async () => {
    await http().get('/api/v1/users').expect(401);
    const sale = (await login('sale1', USER_PW).expect(200)).body.accessToken;
    const res = await http().get('/api/v1/users').set(bearer(sale)).expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
    await http()
      .post('/api/v1/users')
      .set(bearer(sale))
      .send({
        username: 'hacker',
        fullName: 'x',
        role: 'manager',
        branchIds: [],
      })
      .expect(403);
    expect(
      await db.select().from(users).where(eq(users.username, 'hacker')),
    ).toHaveLength(0);
  });

  // ------------------------------------------------------------------ tạo

  it('tạo với mật khẩu tự sinh: 201, mã NV, bắt đổi mật khẩu, trả mật khẩu tạm đúng một lần, không lộ băm', async () => {
    const res = await asAdmin
      .post('/api/v1/users')
      .send({
        username: 'KeToan01',
        fullName: 'Nguyễn Văn Ân',
        role: 'accountant',
        phone: '0901234567',
        branchIds: [sg, hn],
        defaultBranchId: hn,
      })
      .expect(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      code: expect.stringMatching(/^NV\d{4}$/),
      username: 'ketoan01', // đã đưa về chữ thường
      role: 'accountant',
      mustChangePassword: true,
      isActive: true,
      defaultBranchId: hn,
    });
    expect([...res.body.branchIds].sort(byText)).toEqual([sg, hn].sort(byText));
    expect(res.body.temporaryPassword).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);

    // đăng nhập được bằng mật khẩu tạm và bị buộc đổi mật khẩu
    const me = await login('ketoan01', res.body.temporaryPassword).expect(200);
    expect(me.body.user.mustChangePassword).toBe(true);
    const blocked = await http()
      .get('/api/v1/users')
      .set(bearer(me.body.accessToken))
      .expect(403);
    expect(['PASSWORD_CHANGE_REQUIRED', 'FORBIDDEN']).toContain(
      blocked.body.code,
    );

    // lấy lại chi tiết: không còn mật khẩu tạm
    const again = await asAdmin.get(`/api/v1/users/${res.body.id}`).expect(200);
    expect(again.body.temporaryPassword).toBeUndefined();
  });

  it('nhật ký tự gắn requestId, người thao tác, IP và cả khi yêu cầu có body JSON (ngữ cảnh không mất sau khi đọc body)', async () => {
    const res = await asAdmin
      .post('/api/v1/users')
      .set('X-Request-Id', 'test-request-0001')
      .send({
        username: 'nhat-ky-1',
        fullName: 'Thử nhật ký',
        role: 'sales',
        branchIds: [sg],
      })
      .expect(201);
    expect(res.headers['x-request-id']).toBe('test-request-0001');
    const [log] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, res.body.id));
    expect(log).toMatchObject({
      action: 'user.create',
      requestId: 'test-request-0001',
      userId: await idOf('quanly2'),
    });
    expect(log?.ip).toEqual(expect.any(String));
  });

  it('tạo với mật khẩu quản trị tự đặt: không trả mật khẩu; đăng nhập được', async () => {
    const res = await asAdmin
      .post('/api/v1/users')
      .send({
        username: 'kho01',
        fullName: 'Thủ kho',
        role: 'warehouse',
        branchIds: [sg],
        password: 'Mat-khau-ban-dau-kho1',
      })
      .expect(201);
    expect(res.body.temporaryPassword).toBeUndefined();
    await login('kho01', 'Mat-khau-ban-dau-kho1').expect(200);
  });

  it('kiểm tra dữ liệu: tên đăng nhập sai dạng, trùng (không phân biệt hoa thường), thiếu chi nhánh, mật khẩu yếu, chi nhánh lạ, mặc định ngoài danh sách', async () => {
    const base = {
      fullName: 'Người thử',
      role: 'sales',
      branchIds: [sg],
    };
    const post = (extra: object) =>
      asAdmin.post('/api/v1/users').send({ ...base, ...extra });

    const badName = await post({ username: 'Có dấu!' }).expect(400);
    expect(badName.body.details[0].field).toBe('username');

    const dup = await post({ username: 'KETOAN01' }).expect(409);
    expect(dup.body.code).toBe('DUPLICATE_USERNAME');

    const noBranch = await post({ username: 'sale-x', branchIds: [] }).expect(
      400,
    );
    expect(noBranch.body.details[0].field).toBe('branchIds');

    const weak = await post({ username: 'sale-y', password: 'ngan' }).expect(
      400,
    );
    expect(weak.body.details[0].field).toBe('password');
    await post({ username: 'sale-z', password: 'sale-z-mat-khau-dai' }).expect(
      400,
    ); // chứa tên đăng nhập

    await post({
      username: 'sale-w',
      branchIds: ['00000000-0000-4000-8000-000000000000'],
    }).expect(400);
    await post({ username: 'sale-v', defaultBranchId: hn }).expect(400);

    // Quản lý có thể không gán chi nhánh (làm việc được ở mọi chi nhánh)
    await asAdmin
      .post('/api/v1/users')
      .send({
        username: 'quanly3',
        fullName: 'Quản lý 3',
        role: 'manager',
        branchIds: [],
      })
      .expect(201);

    // không có người dùng nào bị tạo dở dang
    for (const u of ['sale-x', 'sale-y', 'sale-z', 'sale-w', 'sale-v']) {
      expect(
        await db.select().from(users).where(eq(users.username, u)),
      ).toHaveLength(0);
    }
  });

  // ------------------------------------------------------------------ danh sách

  it('danh sách: phân trang, tìm không dấu, lọc vai trò / trạng thái; không lộ băm mật khẩu', async () => {
    const found = await asAdmin
      .get('/api/v1/users?q=nguyen van an')
      .expect(200);
    expect(
      found.body.data.map((u: { username: string }) => u.username),
    ).toEqual(['ketoan01']);
    expect(JSON.stringify(found.body)).not.toMatch(/passwordHash|argon2/);

    const byPhone = await asAdmin.get('/api/v1/users?q=0901234').expect(200);
    expect(byPhone.body.meta.total).toBe(1);

    const managers = await asAdmin
      .get('/api/v1/users?role=manager')
      .expect(200);
    expect(
      managers.body.data.every((u: { role: string }) => u.role === 'manager'),
    ).toBe(true);
    expect(managers.body.meta.total).toBeGreaterThanOrEqual(3);

    const page = await asAdmin.get('/api/v1/users?limit=2&page=2').expect(200);
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta).toMatchObject({ page: 2, limit: 2 });
    expect(page.body.meta.totalPages).toBe(Math.ceil(page.body.meta.total / 2));

    const inactive = await asAdmin
      .get('/api/v1/users?isActive=false')
      .expect(200);
    expect(inactive.body.meta.total).toBe(0);
    await asAdmin.get('/api/v1/users?limit=1000').expect(400);
    await asAdmin.get('/api/v1/users?role=thuong').expect(400);
  });

  // ------------------------------------------------------------------ sửa / khóa

  it('sửa thông tin và vai trò; xóa số điện thoại bằng null; nhật ký ghi trước/sau mà không có mật khẩu', async () => {
    const id = await idOf('kho01');
    const res = await asAdmin
      .patch(`/api/v1/users/${id}`)
      .send({ fullName: 'Thủ kho Sài Gòn', phone: null, role: 'sales' })
      .expect(200);
    expect(res.body).toMatchObject({
      fullName: 'Thủ kho Sài Gòn',
      phone: null,
      role: 'sales',
    });
    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, id));
    const upd = logs.find((l) => l.action === 'user.update')!;
    expect(upd.before).toMatchObject({ role: 'warehouse' });
    expect(upd.after).toMatchObject({ role: 'sales' });
    expect(JSON.stringify(logs)).not.toMatch(
      /Mat-khau|argon2|temporaryPassword/,
    );
  });

  it('không tự khóa mình, không tự đổi vai trò của mình; không đổi sang vai trò cần chi nhánh khi chưa được gán', async () => {
    const me = await idOf('quanly2');
    const self1 = await asAdmin
      .patch(`/api/v1/users/${me}`)
      .send({ isActive: false })
      .expect(400);
    expect(self1.body.code).toBe('INVALID_STATE');
    await asAdmin
      .patch(`/api/v1/users/${me}`)
      .send({ role: 'accountant' })
      .expect(400);

    // quanly3 chưa có chi nhánh nào → không thể hạ xuống vai trò thường
    const q3 = await idOf('quanly3');
    const res = await asAdmin
      .patch(`/api/v1/users/${q3}`)
      .send({ role: 'sales' })
      .expect(400);
    expect(res.body.details[0].field).toBe('role');
  });

  it('khóa tài khoản: thu hồi mọi phiên NGAY (token cũ và refresh token đều vô hiệu); mở khóa thì đăng nhập lại được', async () => {
    const id = await idOf('sale1');
    const s = await login('sale1', USER_PW).expect(200);
    await http()
      .get('/api/v1/auth/me')
      .set(bearer(s.body.accessToken))
      .expect(200);

    await asAdmin
      .patch(`/api/v1/users/${id}`)
      .send({ isActive: false })
      .expect(200);

    await http()
      .get('/api/v1/auth/me')
      .set(bearer(s.body.accessToken))
      .expect(401);
    const cookie = (s.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('refresh_token='),
    )!;
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie.split(';')[0]!)
      .expect(401);
    await login('sale1', USER_PW).expect(401);
    const live = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, id));
    expect(live.every((r) => r.revokedAt !== null)).toBe(true);
    expect(live.some((r) => r.revokeReason === 'admin')).toBe(true);

    await asAdmin
      .patch(`/api/v1/users/${id}`)
      .send({ isActive: true })
      .expect(200);
    await login('sale1', USER_PW).expect(200);
  });

  // ------------------------------------------------------------------ đặt lại mật khẩu

  it('đặt lại mật khẩu: mật khẩu cũ mất hiệu lực, phiên bị thu hồi, bắt đổi mật khẩu; không áp dụng cho chính mình', async () => {
    const id = await idOf('kho01');
    const before = await login('kho01', 'Mat-khau-ban-dau-kho1').expect(200);

    const res = await asAdmin
      .post(`/api/v1/users/${id}/reset-password`)
      .send({})
      .expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.temporaryPassword).toEqual(expect.any(String));

    await http()
      .get('/api/v1/auth/me')
      .set(bearer(before.body.accessToken))
      .expect(200); // access token còn hạn (JWT không trạng thái) nhưng...
    const cookie = (before.headers['set-cookie'] as unknown as string[]).find(
      (c) => c.startsWith('refresh_token='),
    )!;
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie.split(';')[0]!)
      .expect(401); // ...không làm mới được nữa
    await login('kho01', 'Mat-khau-ban-dau-kho1').expect(401);
    const [afterReset] = await db.select().from(users).where(eq(users.id, id));
    expect(afterReset!.passwordChangedAt).toBeInstanceOf(Date); // mốc để token cũ bị từ chối ngay
    const again = await login('kho01', res.body.temporaryPassword).expect(200);
    expect(again.body.user.mustChangePassword).toBe(true);

    // quản trị tự đặt mật khẩu mới: kiểm tra chính sách, không trả lại mật khẩu
    await asAdmin
      .post(`/api/v1/users/${id}/reset-password`)
      .send({ newPassword: 'ngan' })
      .expect(400);
    const set = await asAdmin
      .post(`/api/v1/users/${id}/reset-password`)
      .send({ newPassword: 'Mat-khau-do-quan-tri-dat-1' })
      .expect(200);
    expect(set.body.temporaryPassword).toBeUndefined();
    await login('kho01', 'Mat-khau-do-quan-tri-dat-1').expect(200);

    const self = await asAdmin
      .post(`/api/v1/users/${await idOf('quanly2')}/reset-password`)
      .send({})
      .expect(400);
    expect(self.body.code).toBe('INVALID_STATE');

    const logs = await db.select().from(auditLogs);
    expect(logs.some((l) => l.action === 'user.reset_password')).toBe(true);
    expect(JSON.stringify(logs)).not.toMatch(
      new RegExp(`${res.body.temporaryPassword}|Mat-khau-do-quan-tri`),
    );
  });

  // ------------------------------------------------------------------ gán chi nhánh

  it('gán chi nhánh: thay thế danh sách; mặc định không còn được gán thì bị bỏ; vai trò thường không được để trống', async () => {
    const id = await idOf('ketoan01'); // đang có [sg, hn], mặc định hn
    const only = await asAdmin
      .put(`/api/v1/users/${id}/branches`)
      .send({ branchIds: [sg] })
      .expect(200);
    expect(only.body.branchIds).toEqual([sg]);
    expect(only.body.defaultBranchId).toBeNull();

    const withDefault = await asAdmin
      .put(`/api/v1/users/${id}/branches`)
      .send({ branchIds: [sg, hn], defaultBranchId: sg })
      .expect(200);
    expect(withDefault.body.defaultBranchId).toBe(sg);

    // chi nhánh mặc định không nằm trong danh sách mới → 400
    await asAdmin
      .put(`/api/v1/users/${id}/branches`)
      .send({ branchIds: [hn], defaultBranchId: sg })
      .expect(400);
    await asAdmin
      .put(`/api/v1/users/${id}/branches`)
      .send({ branchIds: [] })
      .expect(400);
    await asAdmin
      .put(`/api/v1/users/${id}/branches`)
      .send({ branchIds: ['00000000-0000-4000-8000-000000000000'] })
      .expect(400);

    // lỗi không làm mất dữ liệu cũ
    const check = await asAdmin.get(`/api/v1/users/${id}`).expect(200);
    expect([...check.body.branchIds].sort(byText)).toEqual(
      [sg, hn].sort(byText),
    );

    // Quản lý được để trống
    await asAdmin
      .put(`/api/v1/users/${await idOf('quanly3')}/branches`)
      .send({ branchIds: [] })
      .expect(200);
  });

  it('id không tồn tại → 404 NOT_FOUND; id sai dạng → 400', async () => {
    const missing = '00000000-0000-4000-8000-000000000001';
    for (const res of [
      await asAdmin.get(`/api/v1/users/${missing}`).expect(404),
      await asAdmin.patch(`/api/v1/users/${missing}`).send({}).expect(404),
      await asAdmin
        .post(`/api/v1/users/${missing}/reset-password`)
        .send({})
        .expect(404),
      await asAdmin
        .put(`/api/v1/users/${missing}/branches`)
        .send({ branchIds: [sg] })
        .expect(404),
    ]) {
      expect(res.body.code).toBe('NOT_FOUND');
    }
    const badId = await asAdmin
      .get('/api/v1/users/khong-phai-uuid')
      .expect(400);
    expect(badId.body.code).toBe('VALIDATION_ERROR');
    expect(badId.body.details[0].field).toBe('id');
    expect(badId.body.requestId).toEqual(expect.any(String));
  });

  it('số điện thoại được chuẩn hóa khi lưu; sai định dạng → 400 (field phone); null/rỗng = xóa', async () => {
    const id = await idOf('ketoan01');
    const ok = await asAdmin
      .patch(`/api/v1/users/${id}`)
      .send({ phone: '+84 902 345 678' })
      .expect(200);
    expect(ok.body.phone).toBe('0902345678');
    const bad = await asAdmin
      .patch(`/api/v1/users/${id}`)
      .send({ phone: '12345' })
      .expect(400);
    expect(bad.body.details[0].field).toBe('phone');
    await asAdmin
      .post('/api/v1/users')
      .send({
        username: 'sdt-sai',
        fullName: 'Thử',
        role: 'sales',
        branchIds: [sg],
        phone: 'abc',
      })
      .expect(400);
    const cleared = await asAdmin
      .patch(`/api/v1/users/${id}`)
      .send({ phone: '' })
      .expect(200);
    expect(cleared.body.phone).toBeNull();
  });

  it('bộ đếm mã nhân viên lệch (mã đã tồn tại) → 409 DUPLICATE_CODE, KHÔNG báo nhầm trùng tên đăng nhập; không tạo dở dang', async () => {
    await db
      .update(codeSequences)
      .set({ nextValue: 1 })
      .where(eq(codeSequences.prefix, 'NV')); // NV0001 đã thuộc Quản lý do seed tạo
    const res = await asAdmin
      .post('/api/v1/users')
      .send({
        username: 'lech-ma',
        fullName: 'Thử lệch mã',
        role: 'sales',
        branchIds: [sg],
      })
      .expect(409);
    expect(res.body.code).toBe('DUPLICATE_CODE');
    expect(JSON.stringify(res.body)).not.toMatch(/lech-ma/);
    expect(
      await db.select().from(users).where(eq(users.username, 'lech-ma')),
    ).toHaveLength(0);
    await db
      .update(codeSequences)
      .set({ nextValue: 500 })
      .where(eq(codeSequences.prefix, 'NV'));
  });

  // ------------------------------------------------------------------ phòng thủ ở tầng service

  it('không thể khóa hoặc hạ Quản lý hoạt động cuối cùng (kiểm tra ở tầng service, kể cả khi người gọi không phải Quản lý)', async () => {
    const q2 = await idOf('quanly2');
    const q3 = await idOf('quanly3');
    const seeded = await idOf('quanly');
    // chỉ còn đúng một Quản lý hoạt động: quanly2
    await db.update(users).set({ isActive: false }).where(eq(users.id, q3));
    await db.update(users).set({ isActive: false }).where(eq(users.id, seeded));

    const stranger = { id: await idOf('sale1'), role: 'sales' as Role };
    await expect(
      service.update(stranger, q2, { isActive: false }, {}),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    await expect(
      service.update(stranger, q2, { role: 'accountant' }, {}),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    const still = await db.select().from(users).where(eq(users.id, q2));
    expect(still[0]).toMatchObject({ isActive: true, role: 'manager' });
  });
});
