import { describe, expect, it } from 'vitest';

import { resolveWorkingBranch } from './branch';
import { can, canAny, scopeOf } from './permissions';

const user = {
  permissions: [
    { code: 'invoice.view', scope: 'own' as const },
    { code: 'product.view', scope: 'all' as const },
  ],
};

describe('quyền', () => {
  it('can / scopeOf / canAny theo danh sách permissions', () => {
    expect(can(user, 'product.view')).toBe(true);
    expect(can(user, 'user.manage')).toBe(false);
    expect(can(null, 'product.view')).toBe(false);
    expect(scopeOf(user, 'invoice.view')).toBe('own');
    expect(scopeOf(user, 'cash.view')).toBeNull();
    expect(canAny(user, ['cash.view', 'invoice.view'])).toBe(true);
  });
});

describe('resolveWorkingBranch', () => {
  const branches = [
    { id: 'hn', code: 'HN', name: 'Hà Nội' },
    { id: 'sg', code: 'SG', name: 'Sài Gòn' },
  ];
  it('ưu tiên lựa chọn đã lưu nếu vẫn được phép', () => {
    expect(resolveWorkingBranch({ branches, defaultBranchId: 'hn' }, 'sg')).toBe('sg');
  });
  it('lựa chọn cũ không còn được phép → về chi nhánh mặc định', () => {
    expect(resolveWorkingBranch({ branches, defaultBranchId: 'hn' }, 'cu')).toBe('hn');
  });
  it('không có mặc định → chi nhánh đầu tiên; không có chi nhánh → null', () => {
    expect(resolveWorkingBranch({ branches, defaultBranchId: null }, null)).toBe('hn');
    expect(resolveWorkingBranch({ branches: [], defaultBranchId: null }, null)).toBeNull();
  });
});
