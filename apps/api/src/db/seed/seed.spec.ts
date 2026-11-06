import type { PGlite } from '@electric-sql/pglite';
import { ROLES } from '@kiot/shared';
import { count, eq, isNotNull, type Table } from 'drizzle-orm';
import { verifyPassword } from '../../common/password.js';
import type { Database } from '../database.module.js';
import {
  branches,
  cashAccounts,
  cashCategories,
  codeSequences,
  companyProfile,
  customers,
  rolePermissions,
  suppliers,
  users,
} from '../schema/index.js';
import { createTestDb } from '../test-db.js';
import { CODE_SEQUENCES } from './data.js';
import { runSeed } from './index.js';

const PASSWORD = 'Mat-khau-thu-nghiem-1';

describe('runSeed (CSDL thật trong bộ nhớ)', () => {
  let client: PGlite;
  let db: Database;

  beforeEach(async () => {
    ({ client, db } = await createTestDb());
  });
  afterEach(async () => {
    await client.close();
  });

  const total = async (table: Table): Promise<number> =>
    (await db.select({ n: count() }).from(table))[0]!.n;

  it('tạo đủ dữ liệu khởi tạo', async () => {
    const { report } = await runSeed(db, {
      adminPassword: PASSWORD,
      companyName: 'Công ty thử',
    });
    expect(report).toMatchObject({
      branches: 2,
      branchPartners: 4,
      cashAccounts: 4,
      codeSequences: CODE_SEQUENCES.length,
      companyProfile: 1,
      adminUsers: 1,
    });
    expect(report.cashCategories).toBeGreaterThanOrEqual(10);
    expect(report.rolePermissions).toBeGreaterThan(40);
  });

  it('hai chi nhánh (Hà Nội mặc định, Sài Gòn), mỗi chi nhánh có quỹ tiền mặt + ngân hàng riêng', async () => {
    await runSeed(db, { adminPassword: PASSWORD, companyName: 'Công ty thử' });
    const rows = await db.select().from(branches);
    expect(rows.map((b) => b.code).sort()).toEqual(['HN', 'SG']);
    expect(rows.filter((b) => b.isDefault).map((b) => b.code)).toEqual(['HN']);

    const accounts = await db.select().from(cashAccounts);
    expect(accounts).toHaveLength(4);
    for (const b of rows) {
      const own = accounts.filter((a) => a.branchId === b.id);
      expect(own.map((a) => a.type).sort()).toEqual(['bank', 'cash']);
    }
    const [company] = await db.select().from(companyProfile);
    expect(company?.name).toBe('Công ty thử');
  });

  it('mỗi chi nhánh có 1 khách hàng và 1 nhà cung cấp hệ thống đại diện (cho chuyển kho nội bộ)', async () => {
    await runSeed(db, { adminPassword: PASSWORD });
    const rows = await db.select().from(branches);
    const custs = await db
      .select()
      .from(customers)
      .where(isNotNull(customers.linkedBranchId));
    const supps = await db
      .select()
      .from(suppliers)
      .where(isNotNull(suppliers.linkedBranchId));
    expect(
      custs
        .map((c) => String(c.linkedBranchId))
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(rows.map((b) => b.id).sort((a, b) => a.localeCompare(b)));
    expect(
      supps
        .map((c) => String(c.linkedBranchId))
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(rows.map((b) => b.id).sort((a, b) => a.localeCompare(b)));
    expect(custs.map((c) => c.code).sort()).toEqual(['CN-HN', 'CN-SG']);
    // không lẫn vào khách hàng thật
    expect(custs.find((c) => c.code === 'CN-SG')).toBeDefined();
  });

  it('danh mục thu chi: mã duy nhất, có đủ danh mục hệ thống cho cả hai chiều', async () => {
    await runSeed(db, { adminPassword: PASSWORD });
    const cats = await db.select().from(cashCategories);
    const byCode = new Map(cats.map((c) => [c.code, c]));
    expect(byCode.size).toBe(cats.length);
    expect(byCode.get('customer_payment')).toMatchObject({
      direction: 'in',
      isSystem: true,
    });
    expect(byCode.get('supplier_payment')).toMatchObject({
      direction: 'out',
      isSystem: true,
    });
    expect(byCode.get('customer_refund')).toMatchObject({
      direction: 'out',
      isSystem: true,
    });
    expect(byCode.get('supplier_refund')).toMatchObject({
      direction: 'in',
      isSystem: true,
    });
  });

  it('bộ đếm mã: có đủ tiền tố, mã người dùng 4 chữ số và đã cấp NV0001 cho Quản lý', async () => {
    await runSeed(db, { adminPassword: PASSWORD });
    const seqs = new Map(
      (await db.select().from(codeSequences)).map((s) => [s.prefix, s]),
    );
    for (const p of ['KH', 'NCC', 'DH', 'HD', 'TH', 'PN', 'THN', 'TT', 'CTM']) {
      expect(seqs.get(p), p).toBeDefined();
    }
    expect(seqs.get('NV')).toMatchObject({ digits: 4, nextValue: 2 });
    expect(seqs.get('HD')?.nextValue).toBe(16891);
    expect(seqs.get('CH')).toMatchObject({ nextValue: 1, digits: 6 });
  });

  it('Quản lý đầu tiên: vai trò manager, mật khẩu đã băm và đúng, bắt buộc đổi mật khẩu', async () => {
    const result = await runSeed(db, {
      adminUsername: ' QuanLy ',
      adminPassword: PASSWORD,
    });
    expect(result.generatedAdminPassword).toBeUndefined();
    const [admin] = await db.select().from(users);
    expect(admin).toMatchObject({
      code: 'NV0001',
      username: 'quanly',
      role: 'manager',
      mustChangePassword: true,
      isActive: true,
    });
    expect(admin?.passwordHash).not.toContain(PASSWORD);
    const hnBranch = (
      await db.select().from(branches).where(eq(branches.code, 'HN'))
    )[0];
    expect(admin?.defaultBranchId).toBe(hnBranch?.id);
    expect(await verifyPassword(admin!.passwordHash, PASSWORD)).toBe(true);
  });

  it('không đặt mật khẩu thì sinh ngẫu nhiên, trả về đúng một lần và khớp bản băm', async () => {
    const result = await runSeed(db, {});
    const pw = result.generatedAdminPassword;
    expect(pw).toBeDefined();
    const [admin] = await db
      .select()
      .from(users)
      .where(eq(users.role, 'manager'));
    expect(await verifyPassword(admin!.passwordHash, pw!)).toBe(true);
    const second = await runSeed(db, {});
    expect(second.generatedAdminPassword).toBeUndefined();
  });

  it('từ chối mật khẩu quá ngắn và không ghi gì', async () => {
    await expect(runSeed(db, { adminPassword: 'ngan' })).rejects.toThrow(
      /ít nhất/,
    );
    expect(await total(users)).toBe(0);
    expect(await total(branches)).toBe(0);
  });

  it('chạy lại: không thêm gì, không đổi mật khẩu, không ghi đè dữ liệu đã chỉnh', async () => {
    await runSeed(db, { adminPassword: PASSWORD });
    await db
      .update(codeSequences)
      .set({ nextValue: 20000 })
      .where(eq(codeSequences.prefix, 'HD'));
    await db.delete(rolePermissions).where(eq(rolePermissions.role, 'driver'));
    const [adminBefore] = await db.select().from(users);

    const { report, adminUsername } = await runSeed(db, {
      adminPassword: 'Mat-khau-khac-12345',
    });

    expect(Object.values(report).reduce((a, b) => a + b, 0)).toBe(0);
    expect(adminUsername).toBeUndefined();
    const hd = await db
      .select()
      .from(codeSequences)
      .where(eq(codeSequences.prefix, 'HD'));
    expect(hd[0]?.nextValue).toBe(20000);
    const [adminAfter] = await db.select().from(users);
    expect(adminAfter?.passwordHash).toBe(adminBefore?.passwordHash);
    expect(await total(users)).toBe(1);
    // Quản lý đã xóa hết quyền của Lái xe thì seed lại KHÔNG khôi phục
    const driverRows = (await db.select().from(rolePermissions)).filter(
      (r) => r.role === 'driver',
    );
    expect(driverRows).toHaveLength(0);
  });

  it('quyền mặc định được tạo cho 6 vai trò (trừ Quản lý, luôn đủ quyền)', async () => {
    await runSeed(db, { adminPassword: PASSWORD });
    const roles = new Set(
      (await db.select().from(rolePermissions)).map((r) => r.role),
    );
    expect([...roles].sort()).toEqual(
      ROLES.filter((r) => r !== 'manager').sort(),
    );
  });
});
