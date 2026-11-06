import type { PGlite } from '@electric-sql/pglite';
import { ROLES, defaultGrantsFor } from '@kiot/shared';
import { count, eq } from 'drizzle-orm';
import { createTestDb } from '../../db/test-db.js';
import { auditLogs, rolePermissions, users } from '../../db/schema/index.js';
import type { Database } from '../../db/database.module.js';
import { PermissionsService } from './permissions.service.js';

describe('PermissionsService (CSDL thật trong bộ nhớ)', () => {
  let client: PGlite;
  let db: Database;
  let service: PermissionsService;

  beforeAll(async () => {
    ({ client, db } = await createTestDb());
  });
  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await db.delete(rolePermissions);
    await db.delete(auditLogs);
    await db.delete(users);
    service = new PermissionsService(db);
  });

  const codes = async (role: (typeof ROLES)[number]) =>
    (await service.getGrants(role)).map((g) => g.code);

  it('Quản lý luôn có mọi quyền dù bảng trống', async () => {
    const grants = await service.getGrants('manager');
    expect(grants.length).toBeGreaterThan(20);
    expect(grants.every((g) => g.scope === 'all')).toBe(true);
    expect(await service.getGrant('manager', 'role.manage')).toBeDefined();
  });

  it('bảng trống thì các vai trò khác không có quyền nào (không dùng mặc định trong mã lúc chạy)', async () => {
    for (const role of ROLES.filter((r) => r !== 'manager')) {
      expect(await service.getGrants(role)).toEqual([]);
    }
  });

  it('seed khởi tạo đúng mặc định, và chỉ chạy khi bảng còn trống', async () => {
    const inserted = await service.seedDefaultsIfEmpty();
    expect(inserted).toBeGreaterThan(0);
    for (const role of ROLES.filter((r) => r !== 'manager')) {
      expect(await service.getGrants(role)).toEqual(defaultGrantsFor(role));
    }
    expect(await service.seedDefaultsIfEmpty()).toBe(0);

    // Quản lý đổi cấu hình, chạy seed lại KHÔNG được ghi đè
    await service.setGrants('driver', [
      { code: 'delivery.view' },
      { code: 'product.view' },
    ]);
    await service.seedDefaultsIfEmpty();
    expect(await codes('driver')).toEqual(['product.view', 'delivery.view']);
  });

  it('setGrants lưu, đọc lại đúng, tự thêm quyền bắt buộc và có hiệu lực ngay (đệm được làm mới)', async () => {
    expect(await codes('marketing')).toEqual([]); // nạp đệm
    const result = await service.setGrants('marketing', [
      { code: 'invoice.create', scope: 'own' },
    ]);
    expect(result.autoAdded).toEqual(
      expect.arrayContaining([
        'invoice.view',
        'order.view',
        'customer.view',
        'product.view',
      ]),
    );
    const after = await service.getGrants('marketing');
    expect(after.find((g) => g.code === 'invoice.create')?.scope).toBe('own');
    expect(after.find((g) => g.code === 'customer.view')?.scope).toBe('all');

    const [{ n }] = await db
      .select({ n: count() })
      .from(rolePermissions)
      .where(eq(rolePermissions.role, 'marketing'));
    expect(n).toBe(after.length);
  });

  it('thay thế toàn bộ: quyền không còn trong danh sách mới bị thu hồi', async () => {
    await service.setGrants('assistant', [
      { code: 'product.view' },
      { code: 'product.edit' },
    ]);
    await service.setGrants('assistant', [{ code: 'product.view' }]);
    expect(await codes('assistant')).toEqual(['product.view']);
    await service.setGrants('assistant', []);
    expect(await codes('assistant')).toEqual([]);
  });

  it('không chỉnh được Quản lý (ROLE_LOCKED)', async () => {
    await expect(service.setGrants('manager', [])).rejects.toMatchObject({
      status: 409,
      code: 'ROLE_LOCKED',
    });
    await expect(service.resetToDefaults('manager')).rejects.toMatchObject({
      code: 'ROLE_LOCKED',
    });
  });

  it('từ chối mã quyền lạ và quyền chỉ-Quản-lý, không ghi gì vào CSDL', async () => {
    await expect(
      service.setGrants('sales', [{ code: 'khong.co' }]),
    ).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
    await expect(
      service.setGrants('sales', [
        { code: 'role.manage' },
        { code: 'product.view' },
      ]),
    ).rejects.toMatchObject({ status: 400, code: 'PERMISSION_LOCKED' });
    const [{ n }] = await db.select({ n: count() }).from(rolePermissions);
    expect(n).toBe(0);
  });

  it('resetToDefaults khôi phục mặc định', async () => {
    await service.setGrants('warehouse', [{ code: 'product.view' }]);
    await service.resetToDefaults('warehouse');
    expect(await service.getGrants('warehouse')).toEqual(
      defaultGrantsFor('warehouse'),
    );
  });

  it('ghi nhật ký thao tác với bộ quyền trước và sau', async () => {
    await service.setGrants('sales', [{ code: 'product.view' }]);
    await service.setGrants('sales', [
      { code: 'product.view' },
      { code: 'product.edit' },
    ]);
    const logs = await db.select().from(auditLogs).orderBy(auditLogs.createdAt);
    expect(logs).toHaveLength(2);
    expect(logs[1]?.action).toBe('role.permissions.update');
    expect(logs[1]?.entityType).toBe('role_permissions:sales');
    expect(logs[1]?.before).toEqual([{ code: 'product.view', scope: 'all' }]);
    expect(logs[1]?.after).toHaveLength(2);
  });

  it('bỏ qua mã quyền cũ còn sót trong CSDL nhưng đã bị xóa khỏi danh mục', async () => {
    await service.setGrants('driver', [{ code: 'delivery.view' }]);
    await db
      .insert(rolePermissions)
      .values({ role: 'driver', permissionCode: 'quyen.da.xoa' });
    service.clearCache();
    expect(await codes('driver')).toEqual(['delivery.view']);
  });

  it('listRoleSummaries: số quyền và số người dùng từng vai trò', async () => {
    await service.setGrants('sales', [{ code: 'product.view' }]);
    await db.insert(users).values([
      {
        code: 'NV0001',
        username: 'a',
        fullName: 'A',
        passwordHash: 'x',
        role: 'sales',
      },
      {
        code: 'NV0002',
        username: 'b',
        fullName: 'B',
        passwordHash: 'x',
        role: 'sales',
      },
      {
        code: 'NV0003',
        username: 'c',
        fullName: 'C',
        passwordHash: 'x',
        role: 'manager',
      },
    ]);
    const list = await service.listRoleSummaries();
    expect(list.map((r) => r.role)).toEqual([...ROLES]);
    expect(list.find((r) => r.role === 'sales')).toMatchObject({
      permissionCount: 1,
      userCount: 2,
      locked: false,
    });
    expect(list.find((r) => r.role === 'manager')).toMatchObject({
      userCount: 1,
      locked: true,
    });
    expect(list.find((r) => r.role === 'driver')).toMatchObject({
      permissionCount: 0,
      userCount: 0,
    });
  });
});
