import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  importStatus,
  importType,
  permissionScope,
  userRole,
} from './enums.js';
import { pk, softDelete, timestamps, tstz } from './_helpers.js';

/** Chi nhánh / kho. Hiện chỉ có 1 ("Chi nhánh trung tâm") nhưng mọi chứng từ đều gắn chi nhánh. */
export const branches = pgTable(
  'branches',
  {
    id: pk(),
    code: text().notNull().unique(),
    name: text().notNull(),
    address: text(),
    phone: text(),
    isDefault: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('branches_one_default')
      .on(t.isDefault)
      .where(sql`${t.isDefault}`),
  ],
);

/** Người dùng đăng nhập. Vai trò cố định (enum); quyền chi tiết suy ra từ vai trò trong mã nguồn. */
export const users = pgTable(
  'users',
  {
    id: pk(),
    code: text().notNull().unique(),
    username: text().notNull().unique(),
    fullName: text().notNull(),
    passwordHash: text().notNull(),
    /** Bắt đổi mật khẩu ở lần đăng nhập kế tiếp (tài khoản mới tạo / vừa đặt lại). */
    mustChangePassword: boolean().notNull().default(false),
    role: userRole().notNull(),
    phone: text(),
    defaultBranchId: uuid().references(() => branches.id),
    isActive: boolean().notNull().default(true),
    lastLoginAt: tstz(),
    /** Lần cuối đổi/đặt lại mật khẩu. Access token cấp TRƯỚC mốc này bị từ chối ngay (null = chưa từng đổi). */
    passwordChangedAt: tstz(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index('users_role_idx').on(t.role),
    // Tên đăng nhập không phân biệt hoa thường: chặn 'An' và 'an' cùng tồn tại (service luôn đưa về chữ thường)
    uniqueIndex('users_username_lower_unique').on(sql`lower(${t.username})`),
  ],
);

/** Refresh token (lưu băm, không lưu token thô). */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: pk(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text().notNull().unique(),
    expiresAt: tstz().notNull(),
    revokedAt: tstz(),
    /** Lý do thu hồi: rotated | logout | password_change | reuse. Chỉ `rotated` bị dùng lại mới coi là nghi bị đánh cắp. */
    revokeReason: text(),
    userAgent: text(),
    ip: text(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [index('refresh_tokens_user_idx').on(t.userId)],
);

/** Nhật ký thao tác (chỉ thêm, không sửa). */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: pk(),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: uuid(),
    before: jsonb(),
    after: jsonb(),
    ip: text(),
    /** Mã yêu cầu HTTP (cùng giá trị với header X-Request-Id và `requestId` trong lỗi) để lần ngược log. */
    requestId: text(),
    /** Chi nhánh đang làm việc của yêu cầu (nếu có). */
    branchId: uuid().references(() => branches.id),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_request_idx').on(t.requestId),
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_created_idx').on(t.createdAt),
  ],
);

/** Bộ đếm sinh mã chứng từ theo tiền tố (HD, DH, PN…). Khởi tạo = số lớn nhất hiện có + 1. */
export const codeSequences = pgTable('code_sequences', {
  prefix: text().primaryKey(),
  nextValue: bigint({ mode: 'number' }).notNull().default(1),
  digits: integer().notNull().default(6),
  updatedAt: tstz().notNull().defaultNow(),
});

/** Thông tin công ty (1 dòng) dùng cho mẫu in. */
export const companyProfile = pgTable('company_profile', {
  id: pk(),
  name: text().notNull(),
  address: text(),
  phone: text(),
  email: text(),
  taxCode: text(),
  bankName: text(),
  bankAccount: text(),
  logoUrl: text(),
  invoiceNote: text(),
  updatedAt: tstz().notNull().defaultNow(),
});

/** Chống tạo trùng khi gửi lại yêu cầu (header Idempotency-Key). */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: pk(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    key: text().notNull(),
    endpoint: text().notNull(),
    requestHash: text().notNull(),
    responseStatus: integer(),
    responseBody: jsonb(),
    resourceType: text(),
    resourceId: uuid(),
    createdAt: tstz().notNull().defaultNow(),
    expiresAt: tstz().notNull(),
  },
  (t) => [
    uniqueIndex('idempotency_user_key_uq').on(t.userId, t.key),
    index('idempotency_expires_idx').on(t.expiresAt),
  ],
);

/** Công việc import Excel (chạy nền). */
export const importJobs = pgTable('import_jobs', {
  id: pk(),
  type: importType().notNull(),
  status: importStatus().notNull().default('queued'),
  dryRun: boolean().notNull().default(true),
  fileName: text(),
  total: integer().notNull().default(0),
  created: integer().notNull().default(0),
  updated: integer().notNull().default(0),
  failed: integer().notNull().default(0),
  errors: jsonb(),
  createdBy: uuid().references(() => users.id),
  createdAt: tstz().notNull().defaultNow(),
  finishedAt: tstz(),
});

/**
 * Chi nhánh mà người dùng được phép làm việc. Vai trò `manager` luôn thấy mọi chi nhánh (không cần dòng ở đây).
 * Người dùng khác chỉ thấy dữ liệu của các chi nhánh được gán.
 */
export const userBranches = pgTable(
  'user_branches',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.branchId] }),
    index('user_branches_branch_idx').on(t.branchId),
  ],
);

/**
 * Quyền của từng vai trò — do Quản lý chỉnh. Vai trò `manager` KHÔNG lưu ở đây (luôn có mọi quyền).
 * `permission_code` thuộc danh mục trong packages/shared/src/permissions.ts (kiểm tra ở tầng ứng dụng).
 */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    role: userRole().notNull(),
    permissionCode: text().notNull(),
    scope: permissionScope().notNull().default('all'),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    updatedAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.role, t.permissionCode] }),
    index('role_permissions_role_idx').on(t.role),
  ],
);
