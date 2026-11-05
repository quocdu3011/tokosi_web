import { describe, expect, it } from 'vitest';

import { isNavActive } from './navigation';

describe('isNavActive', () => {
  it('khớp chính xác và trang con', () => {
    expect(isNavActive('/products', '/products')).toBe(true);
    expect(isNavActive('/settings/users', '/settings/users')).toBe(true);
  });
  it('mục cha không sáng khi đang ở mục con có đường dẫn dài hơn', () => {
    expect(isNavActive('/products/categories', '/products/categories')).toBe(true);
    expect(isNavActive('/products/categories', '/products')).toBe(false);
  });
  it('trang chủ chỉ sáng ở đúng "/"', () => {
    expect(isNavActive('/', '/')).toBe(true);
    expect(isNavActive('/products', '/')).toBe(false);
  });
  it('không khớp tiền tố giả (/products-x)', () => {
    expect(isNavActive('/products-x', '/products')).toBe(false);
  });
});
