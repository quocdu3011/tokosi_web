import { describe, expect, it } from 'vitest';
import {
  ADMIN_ROLE,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_CODES,
  ROLES,
  defaultGrantsFor,
  getPermissionDef,
  normalizeGrants,
} from './permissions.js';

describe('danh mục quyền', () => {
  it('mã quyền không trùng và theo dạng module.hanh_dong', () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length);
    for (const c of PERMISSION_CODES) expect(c).toMatch(/^[a-z]+(\.[a-z]+)+$/);
  });

  it('mọi quyền "requires" đều tồn tại và không vòng lặp tới chính nó', () => {
    for (const p of PERMISSIONS) {
      for (const r of (p as { requires?: readonly string[] }).requires ?? []) {
        expect(getPermissionDef(r), `${p.code} cần ${r}`).toBeDefined();
        expect(r).not.toBe(p.code);
      }
    }
  });

  it('có đúng 7 vai trò, Quản lý là vai trò quản trị', () => {
    expect(ROLES).toHaveLength(7);
    expect(ADMIN_ROLE).toBe('manager');
  });
});

describe('normalizeGrants', () => {
  it('Quản lý luôn có đủ quyền, bất kể đầu vào', () => {
    const r = normalizeGrants('manager', []);
    expect(r.grants).toHaveLength(PERMISSION_CODES.length);
    expect(r.grants.every((g) => g.scope === 'all')).toBe(true);
  });

  it('tự thêm quyền bắt buộc và báo lại', () => {
    const r = normalizeGrants('assistant', [{ code: 'invoice.create', scope: 'all' }]);
    const codes = r.grants.map((g) => g.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'invoice.create',
        'invoice.view',
        'order.view',
        'customer.view',
        'product.view',
      ]),
    );
    expect(r.autoAdded).toEqual(expect.arrayContaining(['invoice.view', 'order.view']));
    expect(r.autoAdded).not.toContain('invoice.create');
  });

  it('phạm vi "own" lan sang quyền bắt buộc có hỗ trợ phạm vi', () => {
    const r = normalizeGrants('sales', [{ code: 'invoice.create', scope: 'own' }]);
    const scope = (c: string) => r.grants.find((g) => g.code === c)?.scope;
    expect(scope('invoice.create')).toBe('own');
    expect(scope('invoice.view')).toBe('own');
    expect(scope('customer.view')).toBe('own');
    expect(scope('product.view')).toBe('all'); // product.view không có phạm vi
  });

  it('quyền bắt buộc nhận phạm vi rộng hơn nếu quyền gốc rộng hơn', () => {
    const r = normalizeGrants('sales', [
      { code: 'invoice.view', scope: 'own' },
      { code: 'invoice.create', scope: 'all' },
    ]);
    expect(r.grants.find((g) => g.code === 'invoice.view')?.scope).toBe('all');
  });

  it('ép phạm vi về all với quyền không hỗ trợ "own"', () => {
    const r = normalizeGrants('sales', [{ code: 'invoice.cancel', scope: 'own' }]);
    expect(r.grants.find((g) => g.code === 'invoice.cancel')?.scope).toBe('all');
  });

  it('từ chối mã lạ và quyền chỉ dành cho Quản lý', () => {
    const r = normalizeGrants('assistant', [
      { code: 'khong.ton.tai' },
      { code: 'role.manage' },
      { code: 'user.manage' },
      { code: 'product.view' },
    ]);
    expect(r.unknown).toEqual(['khong.ton.tai']);
    expect(r.lockedRejected).toEqual(['role.manage', 'user.manage']);
    expect(r.grants.map((g) => g.code)).toEqual(['product.view']);
  });

  it('bỏ trùng và có thứ tự ổn định theo danh mục', () => {
    const r = normalizeGrants('marketing', [
      { code: 'report.sales' },
      { code: 'product.view' },
      { code: 'product.view' },
    ]);
    expect(r.grants.map((g) => g.code)).toEqual(['product.view', 'report.sales']);
  });

  it('bộ rỗng cho ra bộ rỗng', () => {
    expect(normalizeGrants('driver', []).grants).toEqual([]);
  });
});

describe('cấu hình mặc định', () => {
  it('đã chuẩn hóa sẵn: chuẩn hóa lần nữa không thêm gì', () => {
    for (const role of ROLES) {
      const grants = defaultGrantsFor(role);
      const again = normalizeGrants(role, grants);
      expect(again.autoAdded, role).toEqual([]);
      expect(again.unknown, role).toEqual([]);
      expect(again.grants, role).toEqual(grants);
    }
  });

  it('không cấp quyền chỉ-Quản-lý cho vai trò khác', () => {
    for (const role of ROLES.filter((r) => r !== 'manager')) {
      const codes = defaultGrantsFor(role as Exclude<(typeof ROLES)[number], 'manager'>).map(
        (g) => g.code,
      );
      expect(codes).not.toContain('role.manage');
      expect(codes).not.toContain('user.manage');
    }
    expect(Object.keys(DEFAULT_ROLE_PERMISSIONS)).toHaveLength(6);
  });

  it('Lái xe chỉ xem phiếu giao hàng; Sale chỉ thấy dữ liệu của mình; Kho không thấy giá vốn', () => {
    expect(defaultGrantsFor('driver')).toEqual([{ code: 'delivery.view', scope: 'all' }]);
    const sales = defaultGrantsFor('sales');
    expect(sales.find((g) => g.code === 'invoice.view')?.scope).toBe('own');
    expect(sales.find((g) => g.code === 'customer.view')?.scope).toBe('own');
    expect(defaultGrantsFor('warehouse').map((g) => g.code)).not.toContain('product.cost.view');
    expect(defaultGrantsFor('sales').map((g) => g.code)).not.toContain('product.cost.view');
  });
});
