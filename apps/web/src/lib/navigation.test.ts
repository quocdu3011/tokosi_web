import { describe, expect, it } from 'vitest';

import { findNavItem, isNavActive } from './navigation';

describe('isNavActive', () => {
  it('khớp chính xác và trang con', () => {
    expect(isNavActive('/products', '/products')).toBe(true);
    expect(isNavActive('/settings/users', '/settings/users')).toBe(true);
  });
  it('hàng hóa không còn mục nhóm và vẫn sáng ở trang con', () => {
    expect(findNavItem('/products/categories')).toBeUndefined();
    expect(isNavActive('/products/example', '/products')).toBe(true);
  });
  it('mục cha không sáng khi có mục menu con khớp dài hơn', () => {
    expect(isNavActive('/settings/users', '/settings/users')).toBe(true);
    expect(isNavActive('/settings/users', '/settings')).toBe(false);
  });
  it('trang chủ chỉ sáng ở đúng "/"', () => {
    expect(isNavActive('/', '/')).toBe(true);
    expect(isNavActive('/products', '/')).toBe(false);
  });
  it('không khớp tiền tố giả (/products-x)', () => {
    expect(isNavActive('/products-x', '/products')).toBe(false);
  });
});
