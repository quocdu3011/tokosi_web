import { describe, expect, it } from 'vitest';

import type { PermissionCatalog } from '@/lib/api/types';

import { disableGrant, enableGrant, indexCatalog, sameGrants, toGrantMap } from './role-matrix';

const catalog: PermissionCatalog = {
  modules: [
    {
      key: 'sales',
      label: 'Đơn hàng',
      permissions: [
        {
          code: 'customer.view',
          label: 'Xem KH',
          scopable: true,
          requires: [],
          lockedToAdmin: false,
        },
        {
          code: 'product.view',
          label: 'Xem hàng',
          scopable: false,
          requires: [],
          lockedToAdmin: false,
        },
        {
          code: 'invoice.view',
          label: 'Xem HĐ',
          scopable: true,
          requires: ['customer.view'],
          lockedToAdmin: false,
        },
        {
          code: 'invoice.create',
          label: 'Tạo HĐ',
          scopable: true,
          requires: ['invoice.view', 'product.view'],
          lockedToAdmin: false,
        },
        { code: 'user.manage', label: 'QL ND', scopable: false, requires: [], lockedToAdmin: true },
      ],
    },
  ],
};
const defs = indexCatalog(catalog);

describe('ma trận phân quyền', () => {
  it('bật quyền → tự bật quyền đi kèm (đệ quy), quyền không scopable luôn là all', () => {
    const { next, added } = enableGrant(new Map(), 'invoice.create', 'own', defs);
    expect(Object.fromEntries(next)).toEqual({
      'invoice.create': 'own',
      'invoice.view': 'own',
      'customer.view': 'own',
      'product.view': 'all',
    });
    expect(added.sort()).toEqual(['customer.view', 'invoice.view', 'product.view']);
  });

  it('quyền đi kèm đã bật thì giữ nguyên phạm vi', () => {
    const start = toGrantMap([{ code: 'customer.view', scope: 'all' }]);
    const { next, added } = enableGrant(start, 'invoice.view', 'own', defs);
    expect(next.get('customer.view')).toBe('all');
    expect(added).toEqual([]);
  });

  it('không cấp được quyền chỉ dành cho Quản lý', () => {
    const { next } = enableGrant(new Map(), 'user.manage', 'all', defs);
    expect(next.size).toBe(0);
  });

  it('tắt quyền → tắt kèm các quyền phụ thuộc', () => {
    const start = enableGrant(new Map(), 'invoice.create', 'all', defs).next;
    const { next, removed } = disableGrant(start, 'customer.view', defs);
    expect([...next.keys()]).toEqual(['product.view']);
    expect(removed.sort()).toEqual(['invoice.create', 'invoice.view']);
  });

  it('so sánh hai bộ quyền', () => {
    const a = toGrantMap([{ code: 'x', scope: 'all' }]);
    expect(sameGrants(a, toGrantMap([{ code: 'x', scope: 'all' }]))).toBe(true);
    expect(sameGrants(a, toGrantMap([{ code: 'x', scope: 'own' }]))).toBe(false);
  });
});
