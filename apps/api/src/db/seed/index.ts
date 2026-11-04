import { USER_CODE_PREFIX } from '@kiot/shared';
import { count, eq } from 'drizzle-orm';
import {
  MIN_PASSWORD_LENGTH,
  generatePassword,
  hashPassword,
} from '../../common/password.js';
import { PermissionsService } from '../../modules/authorization/permissions.service.js';
import { nextDocumentCode } from '../code-sequence.js';
import type { Database } from '../database.module.js';
import {
  branches,
  cashAccounts,
  cashCategories,
  codeSequences,
  companyProfile,
  customers,
  priceBooks,
  suppliers,
  users,
} from '../schema/index.js';
import {
  BRANCHES,
  BRANCH_SHORT_NAMES,
  CASH_ACCOUNT_TEMPLATES,
  CASH_CATEGORIES,
  CODE_SEQUENCES,
  PRICE_BOOKS,
} from './data.js';

export interface SeedOptions {
  /** Tên đăng nhập của Quản lý đầu tiên (mặc định `quanly`). */
  adminUsername?: string;
  /** Mật khẩu của Quản lý đầu tiên. Bỏ trống → sinh ngẫu nhiên và trả về trong kết quả. */
  adminPassword?: string;
  /** Tên công ty hiển thị trên mẫu in. */
  companyName?: string;
}

export interface SeedReport {
  branches: number;
  branchPartners: number;
  priceBooks: number;
  cashAccounts: number;
  cashCategories: number;
  codeSequences: number;
  companyProfile: number;
  rolePermissions: number;
  adminUsers: number;
}

export interface SeedResult {
  /** Số dòng đã THÊM ở mỗi nhóm (0 = đã có sẵn, không đổi gì). */
  report: SeedReport;
  /** Có giá trị khi mật khẩu Quản lý do hệ thống sinh ngẫu nhiên — chỉ lộ ra một lần này. */
  generatedAdminPassword?: string;
  adminUsername?: string;
}

/**
 * Nạp dữ liệu khởi tạo. Chạy lại bao nhiêu lần cũng an toàn: chỉ thêm cái còn thiếu theo mã/khóa,
 * không ghi đè dữ liệu người dùng đã chỉnh (giá, tên, quyền, mật khẩu…).
 */
export async function runSeed(
  db: Database,
  options: SeedOptions = {},
): Promise<SeedResult> {
  const adminUsername = (
    options.adminUsername?.trim() || 'quanly'
  ).toLowerCase();
  if (
    options.adminPassword !== undefined &&
    options.adminPassword.length < MIN_PASSWORD_LENGTH
  ) {
    throw new Error(
      `Mật khẩu Quản lý phải dài ít nhất ${MIN_PASSWORD_LENGTH} ký tự`,
    );
  }

  const report: SeedReport = {
    branches: 0,
    branchPartners: 0,
    priceBooks: 0,
    cashAccounts: 0,
    cashCategories: 0,
    codeSequences: 0,
    companyProfile: 0,
    rolePermissions: 0,
    adminUsers: 0,
  };
  let generatedAdminPassword: string | undefined;

  await db.transaction(async (tx) => {
    // Chi nhánh (Hà Nội mặc định, Sài Gòn)
    report.branches = (
      await tx
        .insert(branches)
        .values(BRANCHES.map((b) => ({ ...b })))
        .onConflictDoNothing()
        .returning({ id: branches.id })
    ).length;
    const allBranches = await tx.select().from(branches);
    const defaultBranch =
      allBranches.find((b) => b.isDefault) ?? allBranches[0];
    const branchId = defaultBranch?.id;

    // Mỗi chi nhánh đại diện bằng 1 khách hàng và 1 nhà cung cấp "hệ thống": khi chuyển kho, chi nhánh
    // gửi coi chi nhánh nhận là khách (phải thu), chi nhánh nhận coi chi nhánh gửi là nhà cung cấp (phải trả).
    for (const b of allBranches) {
      const name = `${b.name} (nội bộ)`;
      report.branchPartners += (
        await tx
          .insert(customers)
          .values({
            code: `CN-${b.code}`,
            name,
            type: 'company',
            linkedBranchId: b.id,
          })
          .onConflictDoNothing()
          .returning({ id: customers.id })
      ).length;
      report.branchPartners += (
        await tx
          .insert(suppliers)
          .values({
            code: `CN-${b.code}`,
            name,
            kind: 'other',
            linkedBranchId: b.id,
          })
          .onConflictDoNothing()
          .returning({ id: suppliers.id })
      ).length;
    }

    // Bảng giá
    report.priceBooks = (
      await tx
        .insert(priceBooks)
        .values(PRICE_BOOKS.map((p) => ({ ...p })))
        .onConflictDoNothing()
        .returning({ id: priceBooks.id })
    ).length;

    // Quỹ riêng từng chi nhánh (chỉ tạo cho chi nhánh CHƯA có quỹ nào, vì tên quỹ do người dùng đặt)
    for (const b of allBranches) {
      const [{ n: accountCount }] = await tx
        .select({ n: count() })
        .from(cashAccounts)
        .where(eq(cashAccounts.branchId, b.id));
      if (accountCount > 0) continue;
      const short = BRANCH_SHORT_NAMES[b.code] ?? b.name;
      report.cashAccounts += (
        await tx
          .insert(cashAccounts)
          .values(
            CASH_ACCOUNT_TEMPLATES.map((a) => ({
              name: `${a.name} ${short}`,
              type: a.type,
              branchId: b.id,
            })),
          )
          .returning({ id: cashAccounts.id })
      ).length;
    }

    // Danh mục thu chi
    report.cashCategories = (
      await tx
        .insert(cashCategories)
        .values(CASH_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i })))
        .onConflictDoNothing()
        .returning({ id: cashCategories.id })
    ).length;

    // Bộ đếm mã chứng từ
    report.codeSequences = (
      await tx
        .insert(codeSequences)
        .values(
          CODE_SEQUENCES.map((s) => ({
            prefix: s.prefix,
            nextValue: s.next,
            digits: s.digits,
          })),
        )
        .onConflictDoNothing()
        .returning({ prefix: codeSequences.prefix })
    ).length;

    // Thông tin công ty (1 dòng)
    const [{ n: companyCount }] = await tx
      .select({ n: count() })
      .from(companyProfile);
    if (companyCount === 0) {
      await tx.insert(companyProfile).values({
        name:
          options.companyName?.trim() ||
          'Tên công ty (cập nhật trong Thiết lập)',
      });
      report.companyProfile = 1;
    }

    // Quản lý đầu tiên: chỉ tạo khi hệ thống CHƯA có Quản lý nào
    const [{ n: managerCount }] = await tx
      .select({ n: count() })
      .from(users)
      .where(eq(users.role, 'manager'));
    if (managerCount === 0) {
      const password =
        options.adminPassword ?? (generatedAdminPassword = generatePassword());
      await tx.insert(users).values({
        code: await nextDocumentCode(tx, USER_CODE_PREFIX),
        username: adminUsername,
        fullName: 'Quản lý',
        passwordHash: await hashPassword(password),
        role: 'manager',
        mustChangePassword: true,
        defaultBranchId: branchId ?? null,
      });
      report.adminUsers = 1;
    }
  });

  // Quyền mặc định của các vai trò (tự kiểm tra "bảng còn trống" nên không ghi đè cấu hình đã chỉnh)
  report.rolePermissions = await new PermissionsService(
    db,
  ).seedDefaultsIfEmpty();

  return {
    report,
    generatedAdminPassword,
    adminUsername: report.adminUsers > 0 ? adminUsername : undefined,
  };
}
