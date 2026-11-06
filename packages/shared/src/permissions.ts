/**
 * Vai trò và danh mục quyền.
 *
 * - Danh mục (PERMISSIONS) nằm trong mã vì mỗi quyền gắn với một đoạn mã kiểm tra (`@RequirePermission`).
 * - Việc vai trò nào có quyền nào là DỮ LIỆU trong CSDL (bảng `role_permissions`), do Quản lý chỉnh.
 * - DEFAULT_ROLE_PERMISSIONS chỉ dùng để KHỞI TẠO lần đầu và nút "Khôi phục mặc định".
 *
 * Xem docs/api/README.md mục 8.
 */

export const ROLES = [
  'manager',
  'assistant',
  'accountant',
  'warehouse',
  'driver',
  'sales',
  'marketing',
] as const;
export type Role = (typeof ROLES)[number];

/**
 * Vai trò của tài khoản tự đăng ký bằng Google, đang chờ Quản lý cấp quyền: KHÔNG có quyền nào,
 * không cấu hình được (không nằm trong ROLES) và không có chi nhánh. Quản lý đổi sang vai trò thật.
 */
export const PENDING_ROLE = 'pending' as const;
export const USER_ROLES = [...ROLES, PENDING_ROLE] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  manager: 'Quản lý',
  assistant: 'Trợ lý',
  accountant: 'Kế toán',
  warehouse: 'Kho',
  driver: 'Lái xe',
  sales: 'Sale',
  marketing: 'Marketing',
};

/** Vai trò quản trị: luôn có mọi quyền, không chỉnh được (tránh tự khóa hệ thống). */
export const ADMIN_ROLE: Role = 'manager';

/** `all` = toàn bộ dữ liệu; `own` = chỉ dữ liệu của mình (khách mình phụ trách, đơn mình bán). */
export type PermissionScope = 'all' | 'own';

export const PERMISSION_MODULES = [
  { key: 'product', label: 'Hàng hóa' },
  { key: 'purchase', label: 'Mua hàng' },
  { key: 'stock', label: 'Kho & chuyển kho' },
  { key: 'customer', label: 'Khách hàng' },
  { key: 'sales', label: 'Đơn hàng' },
  { key: 'cash', label: 'Sổ quỹ & công nợ' },
  { key: 'report', label: 'Tổng quan & báo cáo' },
  { key: 'system', label: 'Hệ thống' },
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number]['key'];

export interface PermissionDef {
  code: string;
  module: PermissionModule;
  label: string;
  description?: string;
  /** Cho phép chọn phạm vi "chỉ của mình". */
  scopable?: boolean;
  /** Quyền bắt buộc đi kèm (cấp quyền này thì tự cấp các quyền kia). */
  requires?: readonly string[];
  /** Chỉ vai trò Quản lý được có; không thể cấp cho vai trò khác. */
  lockedToAdmin?: boolean;
}

export const PERMISSIONS = [
  // ---- Hàng hóa
  {
    code: 'product.view',
    module: 'product',
    label: 'Xem hàng hóa',
    description: 'Danh sách, chi tiết, tồn kho, giá bán, thẻ kho',
  },
  {
    code: 'product.edit',
    module: 'product',
    label: 'Thêm/sửa hàng hóa',
    description: 'Không gồm giá bán (cần "Thiết lập giá") và giá vốn',
    requires: ['product.view'],
  },
  {
    code: 'product.content.edit',
    module: 'product',
    label: 'Sửa mô tả, ảnh hàng hóa',
    description: 'Chỉ mô tả và ảnh, không sửa mã/tên',
    requires: ['product.view'],
  },
  {
    code: 'product.cost.view',
    module: 'product',
    label: 'Xem giá vốn / giá nhập cuối',
    description:
      'Giá vốn, giá nhập cuối của hàng hóa, giá chuyển kho, lãi gộp. Giá nhập trên phiếu đặt hàng nhập / nhập hàng / trả hàng nhập thuộc nghiệp vụ mua hàng: ai có purchase.view đều xem được',
  },
  // ---- Mua hàng
  {
    code: 'purchase.view',
    module: 'purchase',
    label: 'Xem mua hàng',
    description: 'Nhà cung cấp, đặt hàng nhập, phiếu nhập, phiếu trả hàng nhập',
  },
  {
    code: 'purchase.edit',
    module: 'purchase',
    label: 'Đặt hàng nhập / nhập hàng / trả hàng nhập / sửa nhà cung cấp',
    requires: ['purchase.view', 'product.view'],
  },
  {
    code: 'purchase.cancel',
    module: 'purchase',
    label: 'Hủy phiếu đặt nhập / phiếu nhập / phiếu trả nhập',
    requires: ['purchase.view'],
  },
  // ---- Kho & chuyển kho (giữa các chi nhánh)
  {
    code: 'transfer.view',
    module: 'stock',
    label: 'Xem phiếu chuyển kho',
    description: 'Phiếu chuyển kho gửi đi hoặc nhận về của chi nhánh mình được gán',
    requires: ['product.view'],
  },
  {
    code: 'transfer.create',
    module: 'stock',
    label: 'Lập/hủy phiếu chuyển kho (bên gửi)',
    requires: ['transfer.view'],
  },
  {
    code: 'transfer.receive',
    module: 'stock',
    label: 'Xác nhận nhận hàng chuyển kho (bên nhận)',
    requires: ['transfer.view'],
  },
  // ---- Khách hàng
  {
    code: 'customer.view',
    module: 'customer',
    label: 'Xem khách hàng',
    description: 'Không gồm công nợ (cần "Xem công nợ")',
    scopable: true,
  },
  {
    code: 'customer.edit',
    module: 'customer',
    label: 'Thêm/sửa khách hàng',
    scopable: true,
    requires: ['customer.view'],
  },
  // ---- Đơn hàng
  {
    code: 'order.view',
    module: 'sales',
    label: 'Xem đơn đặt hàng',
    scopable: true,
    requires: ['product.view', 'customer.view'],
  },
  {
    code: 'order.create',
    module: 'sales',
    label: 'Tạo/sửa/hủy đơn đặt hàng',
    scopable: true,
    requires: ['order.view'],
  },
  {
    code: 'invoice.view',
    module: 'sales',
    label: 'Xem hóa đơn',
    scopable: true,
    requires: ['customer.view'],
  },
  {
    code: 'invoice.create',
    module: 'sales',
    label: 'Xuất hóa đơn',
    scopable: true,
    requires: ['invoice.view', 'order.view'],
  },
  { code: 'invoice.cancel', module: 'sales', label: 'Hủy hóa đơn', requires: ['invoice.view'] },
  {
    code: 'return.create',
    module: 'sales',
    label: 'Tạo phiếu trả hàng bán',
    description: '"Chỉ của mình" = chỉ trả hàng cho hóa đơn của mình',
    scopable: true,
    requires: ['invoice.view'],
  },
  {
    code: 'delivery.view',
    module: 'sales',
    label: 'Xem/in phiếu giao hàng',
    description: 'Chỉ phiếu giao hàng, không thấy giá',
  },
  // ---- Sổ quỹ & công nợ
  { code: 'cash.view', module: 'cash', label: 'Xem sổ quỹ' },
  {
    code: 'cash.create',
    module: 'cash',
    label: 'Lập phiếu thu/chi, thu nợ khách, trả nợ NCC',
    requires: ['cash.view', 'debt.view'],
  },
  { code: 'cash.cancel', module: 'cash', label: 'Hủy phiếu thu/chi', requires: ['cash.view'] },
  {
    code: 'cash.manage',
    module: 'cash',
    label: 'Quản lý quỹ và danh mục thu chi',
    requires: ['cash.view'],
  },
  { code: 'debt.view', module: 'cash', label: 'Xem công nợ khách / nhà cung cấp', scopable: true },
  // ---- Tổng quan & báo cáo
  { code: 'dashboard.view', module: 'report', label: 'Xem trang Tổng quan' },
  {
    code: 'report.sales',
    module: 'report',
    label: 'Báo cáo doanh số',
    description: 'Lãi gộp chỉ hiện khi có quyền xem giá vốn',
    scopable: true,
  },
  {
    code: 'report.inventory',
    module: 'report',
    label: 'Báo cáo tồn kho',
    requires: ['product.view'],
  },
  { code: 'report.debt', module: 'report', label: 'Báo cáo công nợ', requires: ['debt.view'] },
  { code: 'report.cash', module: 'report', label: 'Báo cáo sổ quỹ', requires: ['cash.view'] },
  // ---- Hệ thống
  { code: 'import.run', module: 'system', label: 'Nhập dữ liệu từ Excel' },
  { code: 'user.manage', module: 'system', label: 'Quản lý người dùng', lockedToAdmin: true },
  { code: 'role.manage', module: 'system', label: 'Phân quyền cho vai trò', lockedToAdmin: true },
] as const satisfies readonly PermissionDef[];

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];

export const PERMISSION_CODES: readonly PermissionCode[] = PERMISSIONS.map((p) => p.code);

export interface Grant {
  code: PermissionCode;
  scope: PermissionScope;
}

const defByCode = new Map<string, PermissionDef>(PERMISSIONS.map((p) => [p.code, p]));

export function getPermissionDef(code: string): PermissionDef | undefined {
  return defByCode.get(code);
}

export function isPermissionCode(code: string): code is PermissionCode {
  return defByCode.has(code);
}

// ---------------------------------------------------------------- mặc định (chỉ để khởi tạo)

type RoleDefaults = Partial<Record<PermissionCode, PermissionScope>>;

const all = (codes: readonly PermissionCode[]): RoleDefaults =>
  Object.fromEntries(codes.map((c) => [c, 'all' as const]));
const own = (codes: readonly PermissionCode[]): RoleDefaults =>
  Object.fromEntries(codes.map((c) => [c, 'own' as const]));

/**
 * Cấu hình mặc định ĐỀ XUẤT (chờ công ty xác nhận). Quản lý luôn có đủ quyền nên không liệt kê.
 * Không dùng lúc chạy: nguồn sự thật là bảng `role_permissions`.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<Exclude<Role, 'manager'>, RoleDefaults> = {
  assistant: all([
    'transfer.view',
    'transfer.create',
    'transfer.receive',
    'product.view',
    'product.edit',
    'purchase.view',
    'purchase.edit',
    'customer.view',
    'customer.edit',
    'order.view',
    'order.create',
    'invoice.view',
    'invoice.create',
    'return.create',
    'debt.view',
    'delivery.view',
  ]),
  accountant: all([
    'product.view',
    'product.cost.view',
    'purchase.view',
    'purchase.edit',
    'purchase.cancel',
    'transfer.view',
    'customer.view',
    'order.view',
    'invoice.view',
    'invoice.cancel',
    'delivery.view',
    'cash.view',
    'cash.create',
    'cash.cancel',
    'cash.manage',
    'debt.view',
    'dashboard.view',
    'report.sales',
    'report.inventory',
    'report.debt',
    'report.cash',
  ]),
  warehouse: all([
    'transfer.view',
    'transfer.create',
    'transfer.receive',
    'product.view',
    'product.edit',
    'purchase.view',
    'purchase.edit',
    'customer.view',
    'order.view',
    'invoice.view',
    'delivery.view',
    'report.inventory',
  ]),
  driver: all(['delivery.view']),
  sales: {
    ...all(['product.view', 'delivery.view']),
    ...own([
      'return.create',
      'customer.view',
      'customer.edit',
      'order.view',
      'order.create',
      'invoice.view',
      'invoice.create',
      'debt.view',
      'report.sales',
    ]),
  },
  marketing: all(['product.view', 'product.content.edit', 'customer.view', 'report.sales']),
};

// ---------------------------------------------------------------- chuẩn hóa

export interface NormalizeResult {
  /** Bộ quyền cuối cùng đã chuẩn hóa. */
  grants: Grant[];
  /** Quyền tự thêm vì là điều kiện bắt buộc của quyền khác. */
  autoAdded: PermissionCode[];
  /** Mã quyền không có trong danh mục. */
  unknown: string[];
  /** Quyền chỉ dành cho Quản lý nhưng bị gán cho vai trò khác. */
  lockedRejected: PermissionCode[];
}

const scopeRank: Record<PermissionScope, number> = { own: 0, all: 1 };
const widest = (a: PermissionScope, b: PermissionScope): PermissionScope =>
  scopeRank[a] >= scopeRank[b] ? a : b;

/**
 * Chuẩn hóa một bộ quyền do người dùng gửi lên:
 * - bỏ trùng; mã lạ vào `unknown`; quyền "chỉ Quản lý" vào `lockedRejected`;
 * - quyền không hỗ trợ "chỉ của mình" thì ép về `all`;
 * - tự thêm quyền bắt buộc (cùng hoặc rộng hơn phạm vi của quyền gốc);
 * - Quản lý luôn nhận đủ quyền.
 */
export function normalizeGrants(
  role: Role,
  input: ReadonlyArray<{ code: string; scope?: PermissionScope }>,
): NormalizeResult {
  const unknown: string[] = [];
  const lockedRejected: PermissionCode[] = [];

  if (role === ADMIN_ROLE) {
    return {
      grants: PERMISSION_CODES.map((code) => ({ code, scope: 'all' as const })),
      autoAdded: [],
      unknown,
      lockedRejected,
    };
  }

  const result = new Map<PermissionCode, PermissionScope>();
  for (const item of input) {
    const def = getPermissionDef(item.code);
    if (!def) {
      if (!unknown.includes(item.code)) unknown.push(item.code);
      continue;
    }
    const code = def.code as PermissionCode;
    if (def.lockedToAdmin) {
      if (!lockedRejected.includes(code)) lockedRejected.push(code);
      continue;
    }
    const scope: PermissionScope = def.scopable ? (item.scope ?? 'all') : 'all';
    result.set(code, widest(result.get(code) ?? 'own', scope));
  }

  const requested = new Set(result.keys());
  const queue = [...result.keys()];
  while (queue.length > 0) {
    const code = queue.shift() as PermissionCode;
    const def = getPermissionDef(code);
    const scope = result.get(code) as PermissionScope;
    for (const req of def?.requires ?? []) {
      const reqDef = getPermissionDef(req);
      if (!reqDef || reqDef.lockedToAdmin) continue;
      const need: PermissionScope = reqDef.scopable ? scope : 'all';
      const current = result.get(req as PermissionCode);
      const next = current ? widest(current, need) : need;
      if (current !== next) {
        result.set(req as PermissionCode, next);
        queue.push(req as PermissionCode);
      }
    }
  }

  const autoAdded = [...result.keys()].filter((c) => !requested.has(c));
  const grants = PERMISSION_CODES.filter((c) => result.has(c)).map((code) => ({
    code,
    scope: result.get(code) as PermissionScope,
  }));
  return { grants, autoAdded, unknown, lockedRejected };
}

/** Bộ quyền mặc định đã chuẩn hóa của một vai trò. */
export function defaultGrantsFor(role: Role): Grant[] {
  if (role === ADMIN_ROLE) return normalizeGrants(role, []).grants;
  const defaults: RoleDefaults = DEFAULT_ROLE_PERMISSIONS[role as Exclude<Role, 'manager'>];
  return normalizeGrants(
    role,
    Object.entries(defaults).map(([code, scope]) => ({ code, scope: scope as PermissionScope })),
  ).grants;
}
