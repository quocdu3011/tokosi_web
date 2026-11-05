import { describe, expect, it } from 'vitest';
import { pageMeta, pageParams, parseSort } from './pagination.js';

describe('phân trang', () => {
  it('pageParams: mặc định, trần limit, offset', () => {
    expect(pageParams({})).toEqual({ page: 1, limit: 20, offset: 0 });
    expect(pageParams({ page: 3, limit: 50 })).toEqual({
      page: 3,
      limit: 50,
      offset: 100,
    });
    expect(pageParams({ page: 1, limit: 500 }, 200).limit).toBe(200);
  });
  it('pageMeta: làm tròn lên số trang', () => {
    expect(pageMeta(1, 20, 2787)).toEqual({
      page: 1,
      limit: 20,
      total: 2787,
      totalPages: 140,
    });
    expect(pageMeta(1, 20, 0).totalPages).toBe(0);
  });
  it('parseSort: chỉ nhận cột cho phép, "-" là giảm dần, cột lạ → undefined', () => {
    const allowed = ['code', 'name', 'createdAt'] as const;
    expect(parseSort('name', allowed)).toEqual({ field: 'name', desc: false });
    expect(parseSort('-createdAt', allowed)).toEqual({
      field: 'createdAt',
      desc: true,
    });
    expect(parseSort('password', allowed)).toBeUndefined();
    expect(parseSort(undefined, allowed)).toBeUndefined();
  });
});
