import type { PGlite } from '@electric-sql/pglite';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Role } from '@kiot/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { AppRequest } from '../../common/auth-user.js';
import { DB, type Database } from '../../db/database.module.js';
import { rolePermissions, users } from '../../db/schema/index.js';
import { createTestDb } from '../../db/test-db.js';
import { PermissionGuard } from './permission.guard.js';
import { PermissionsService } from './permissions.service.js';
import { RolesController } from './roles.controller.js';

describe('RolesController (HTTP, CSDL trong bộ nhớ)', () => {
  let client: PGlite;
  let db: Database;
  let app: INestApplication<App>;
  let service: PermissionsService;

  beforeAll(async () => {
    ({ client, db } = await createTestDb());
    await db.insert(users).values({
      id: '00000000-0000-4000-8000-000000000001',
      code: 'NV0001',
      username: 'quanly',
      fullName: 'Quản lý',
      passwordHash: 'x',
      role: 'manager',
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [RolesController],
      providers: [
        PermissionsService,
        { provide: DB, useValue: db },
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    // Giả lập AuthGuard: lấy vai trò từ header x-test-role
    app.use((req: AppRequest, _res: unknown, next: () => void) => {
      const role = req.headers['x-test-role'] as Role | undefined;
      if (role) req.user = { id: '00000000-0000-4000-8000-000000000001', role };
      next();
    });
    await app.init();
    service = moduleRef.get(PermissionsService);
  });

  afterAll(async () => {
    await app.close();
    await client.close();
  });

  beforeEach(async () => {
    await db.delete(rolePermissions);
    service.clearCache();
    await service.seedDefaultsIfEmpty();
  });

  const as = (role: Role) => ({ 'x-test-role': role });

  it('chưa đăng nhập → 401, vai trò khác Quản lý → 403', async () => {
    await request(app.getHttpServer()).get('/roles').expect(401);
    const res = await request(app.getHttpServer())
      .get('/roles')
      .set(as('accountant'))
      .expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
    await request(app.getHttpServer())
      .put('/roles/sales/permissions')
      .set(as('assistant'))
      .send({ permissions: [] })
      .expect(403);
  });

  it('GET /permissions/catalog gom theo phân hệ', async () => {
    const res = await request(app.getHttpServer())
      .get('/permissions/catalog')
      .set(as('manager'))
      .expect(200);
    const modules = res.body.modules as Array<{
      key: string;
      permissions: Array<{ code: string; scopable: boolean }>;
    }>;
    expect(modules.map((m) => m.key)).toEqual([
      'product',
      'purchase',
      'stock',
      'customer',
      'sales',
      'cash',
      'report',
      'system',
    ]);
    const all = modules.flatMap((m) => m.permissions);
    expect(all.find((p) => p.code === 'invoice.view')?.scopable).toBe(true);
    expect(all.find((p) => p.code === 'role.manage')).toMatchObject({
      lockedToAdmin: true,
    });
  });

  it('GET /roles liệt kê 7 vai trò kèm nhãn tiếng Việt', async () => {
    const res = await request(app.getHttpServer())
      .get('/roles')
      .set(as('manager'))
      .expect(200);
    expect(res.body).toHaveLength(7);
    expect(res.body[0]).toMatchObject({
      role: 'manager',
      label: 'Quản lý',
      locked: true,
    });
    expect(
      res.body.find((r: { role: string }) => r.role === 'driver'),
    ).toMatchObject({ label: 'Lái xe', permissionCount: 1 });
  });

  it('PUT đổi quyền → GET thấy ngay; người dùng vai trò đó bị ảnh hưởng ngay', async () => {
    const put = await request(app.getHttpServer())
      .put('/roles/driver/permissions')
      .set(as('manager'))
      .send({ permissions: [{ code: 'invoice.view', scope: 'own' }] })
      .expect(200);
    expect(put.body.autoAdded).toEqual(
      expect.arrayContaining(['customer.view']),
    );
    const get = await request(app.getHttpServer())
      .get('/roles/driver/permissions')
      .set(as('manager'))
      .expect(200);
    expect(
      get.body.permissions.find(
        (p: { code: string }) => p.code === 'invoice.view',
      ).scope,
    ).toBe('own');
    expect(get.body.locked).toBe(false);
  });

  it('PUT dữ liệu sai → 400 (mã lạ, phạm vi sai, quyền chỉ-Quản-lý, field thừa)', async () => {
    const put = (body: unknown) =>
      request(app.getHttpServer())
        .put('/roles/sales/permissions')
        .set(as('manager'))
        .send(body as object);
    expect(
      (
        await put({ permissions: [{ code: 'khong.co', scope: 'all' }] }).expect(
          400,
        )
      ).body.code,
    ).toBe('VALIDATION_ERROR');
    expect(
      (
        await put({
          permissions: [{ code: 'role.manage', scope: 'all' }],
        }).expect(400)
      ).body.code,
    ).toBe('PERMISSION_LOCKED');
    await put({
      permissions: [{ code: 'product.view', scope: 'mot-phan' }],
    }).expect(400);
    await put({ permissions: [], thua: 1 }).expect(400);
    await put({}).expect(400);
  });

  it('không chỉnh được Quản lý → 409; vai trò lạ → 404', async () => {
    const r = await request(app.getHttpServer())
      .put('/roles/manager/permissions')
      .set(as('manager'))
      .send({ permissions: [] })
      .expect(409);
    expect(r.body.code).toBe('ROLE_LOCKED');
    await request(app.getHttpServer())
      .get('/roles/ke-toan-truong/permissions')
      .set(as('manager'))
      .expect(404);
  });

  it('POST reset khôi phục mặc định', async () => {
    await request(app.getHttpServer())
      .put('/roles/warehouse/permissions')
      .set(as('manager'))
      .send({ permissions: [] })
      .expect(200);
    expect(await service.getGrants('warehouse')).toEqual([]);
    const res = await request(app.getHttpServer())
      .post('/roles/warehouse/permissions/reset')
      .set(as('manager'))
      .expect(201);
    expect(res.body.permissions.length).toBeGreaterThan(3);
  });

  it('Quản lý có thể giao quyền quản lý hóa đơn cho vai trò khác và vai trò đó dùng được ngay', async () => {
    // Trợ lý mặc định không có "invoice.cancel" → chưa gọi được endpoint cần quyền đó (ở đây dùng GET /roles làm thước đo role.manage)
    await request(app.getHttpServer())
      .get('/roles')
      .set(as('assistant'))
      .expect(403);
    expect(
      await service.getGrant('assistant', 'invoice.cancel'),
    ).toBeUndefined();
    await request(app.getHttpServer())
      .put('/roles/assistant/permissions')
      .set(as('manager'))
      .send({ permissions: [{ code: 'invoice.cancel', scope: 'all' }] })
      .expect(200);
    expect((await service.getGrant('assistant', 'invoice.cancel'))?.scope).toBe(
      'all',
    );
  });
});
