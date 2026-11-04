import type { PGlite } from '@electric-sql/pglite';
import type { Role } from '@kiot/shared';
import { eq } from 'drizzle-orm';
import type { AuthUser } from '../../common/auth-user.js';
import type { Database } from '../../db/database.module.js';
import { branches, userBranches, users } from '../../db/schema/index.js';
import { createTestDb } from '../../db/test-db.js';
import { BranchAccessService } from './branch-access.service.js';

describe('BranchAccessService (CSDL thật trong bộ nhớ)', () => {
  let client: PGlite;
  let db: Database;
  let svc: BranchAccessService;
  let sg: string;
  let hn: string;
  let n = 0;

  beforeAll(async () => {
    ({ client, db } = await createTestDb());
    svc = new BranchAccessService(db);
    const rows = await db
      .insert(branches)
      .values([
        { code: 'SG', name: 'Sài Gòn', isDefault: true },
        { code: 'HN', name: 'Hà Nội' },
      ])
      .returning();
    sg = rows.find((b) => b.code === 'SG')!.id;
    hn = rows.find((b) => b.code === 'HN')!.id;
  });
  afterAll(async () => {
    await client.close();
  });

  const makeUser = async (
    role: Role,
    opts: { branchIds?: string[]; defaultBranchId?: string } = {},
  ): Promise<AuthUser> => {
    const [u] = await db
      .insert(users)
      .values({
        code: `NV${++n}`,
        username: `u${n}`,
        fullName: `U${n}`,
        passwordHash: 'x',
        role,
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
    return { id: u!.id, role };
  };

  it('Quản lý thấy mọi chi nhánh đang hoạt động, không cần được gán', async () => {
    const manager = await makeUser('manager');
    expect((await svc.allowedBranchIds(manager)).sort()).toEqual(
      [sg, hn].sort(),
    );
  });

  it('nhân viên chỉ thấy chi nhánh được gán', async () => {
    const sales = await makeUser('sales', { branchIds: [sg] });
    expect(await svc.allowedBranchIds(sales)).toEqual([sg]);
    const nobody = await makeUser('driver');
    expect(await svc.allowedBranchIds(nobody)).toEqual([]);
  });

  it('assertAccess: chặn chi nhánh không được gán bằng BRANCH_FORBIDDEN', async () => {
    const sales = await makeUser('sales', { branchIds: [sg] });
    await expect(svc.assertAccess(sales, sg)).resolves.toBeUndefined();
    await expect(svc.assertAccess(sales, hn)).rejects.toMatchObject({
      status: 403,
      code: 'BRANCH_FORBIDDEN',
    });
  });

  it('resolveWorkingBranch: dùng header nếu hợp lệ', async () => {
    const both = await makeUser('accountant', { branchIds: [sg, hn] });
    expect(await svc.resolveWorkingBranch(both, hn)).toBe(hn);
    const sales = await makeUser('sales', { branchIds: [sg] });
    await expect(svc.resolveWorkingBranch(sales, hn)).rejects.toMatchObject({
      code: 'BRANCH_FORBIDDEN',
    });
  });

  it('resolveWorkingBranch: không header → chi nhánh mặc định của người dùng, hoặc chi nhánh duy nhất', async () => {
    const withDefault = await makeUser('accountant', {
      branchIds: [sg, hn],
      defaultBranchId: hn,
    });
    expect(await svc.resolveWorkingBranch(withDefault)).toBe(hn);
    const single = await makeUser('sales', { branchIds: [hn] });
    expect(await svc.resolveWorkingBranch(single)).toBe(hn);
  });

  it('resolveWorkingBranch: có nhiều chi nhánh mà không chọn → BRANCH_REQUIRED', async () => {
    const both = await makeUser('accountant', { branchIds: [sg, hn] });
    await expect(svc.resolveWorkingBranch(both)).rejects.toMatchObject({
      status: 400,
      code: 'BRANCH_REQUIRED',
    });
    const none = await makeUser('driver');
    await expect(svc.resolveWorkingBranch(none)).rejects.toMatchObject({
      code: 'BRANCH_REQUIRED',
    });
  });

  it('chi nhánh mặc định không còn được phép thì không dùng', async () => {
    const u = await makeUser('sales', {
      branchIds: [sg, hn],
      defaultBranchId: hn,
    });
    await svc.setUserBranches(u.id, [sg]);
    expect(await svc.resolveWorkingBranch(u)).toBe(sg); // chỉ còn 1 chi nhánh được phép
  });

  it('chi nhánh ngừng hoạt động bị loại, kể cả với Quản lý', async () => {
    const [extra] = await db
      .insert(branches)
      .values({ code: 'DN', name: 'Đà Nẵng' })
      .returning();
    const manager = await makeUser('manager');
    const clerk = await makeUser('assistant', { branchIds: [sg, extra!.id] });
    expect(await svc.allowedBranchIds(manager)).toContain(extra!.id);
    await db
      .update(branches)
      .set({ isActive: false })
      .where(eq(branches.id, extra!.id));
    expect(await svc.allowedBranchIds(manager)).not.toContain(extra!.id);
    expect(await svc.allowedBranchIds(clerk)).toEqual([sg]);
  });

  it('setUserBranches thay thế toàn bộ, bỏ trùng và từ chối chi nhánh không tồn tại', async () => {
    const u = await makeUser('sales', { branchIds: [sg] });
    await svc.setUserBranches(u.id, [hn, hn]);
    expect(await svc.allowedBranchIds(u)).toEqual([hn]);
    await svc.setUserBranches(u.id, []);
    expect(await svc.allowedBranchIds(u)).toEqual([]);
    await expect(
      svc.setUserBranches(u.id, ['00000000-0000-4000-8000-000000000000']),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
