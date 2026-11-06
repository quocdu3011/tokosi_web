import { describe, expect, it } from 'vitest';

import {
  initialListState,
  listStateReducer,
  type ListAction,
  type ListState,
} from './use-list-state';

interface Filters extends Record<string, string | number | boolean | null> {
  status: string;
  stock: string;
}

const initial = initialListState<Filters>({ status: 'active', stock: 'all' });

function run(actions: ListAction<Filters>[], from: ListState<Filters> = initial) {
  return actions.reduce(listStateReducer<Filters>, from);
}

describe('listStateReducer', () => {
  it('trạng thái ban đầu: trang 1, cỡ trang 15, chưa tìm/sắp xếp', () => {
    expect(initial).toEqual({
      filters: { status: 'active', stock: 'all' },
      q: '',
      sort: null,
      page: 1,
      pageSize: 15,
    });
  });

  it('đổi bộ lọc tự về trang 1', () => {
    const s = run([
      { type: 'page', page: 4 },
      { type: 'filter', key: 'status', value: 'inactive' },
    ]);
    expect(s.filters.status).toBe('inactive');
    expect(s.page).toBe(1);
  });

  it('chọn lại đúng giá trị đang có thì không đổi gì (giữ trang hiện tại)', () => {
    const at3 = run([{ type: 'page', page: 3 }]);
    expect(listStateReducer(at3, { type: 'filter', key: 'status', value: 'active' })).toBe(at3);
    expect(listStateReducer(at3, { type: 'q', value: '' })).toBe(at3);
    expect(listStateReducer(at3, { type: 'sort', sort: null })).toBe(at3);
  });

  it('gõ từ khóa mới tự về trang 1', () => {
    const s = run([
      { type: 'page', page: 5 },
      { type: 'q', value: 'đèn' },
    ]);
    expect(s).toMatchObject({ q: 'đèn', page: 1 });
  });

  it('đổi sắp xếp tự về trang 1', () => {
    const s = run([
      { type: 'page', page: 2 },
      { type: 'sort', sort: { id: 'code', desc: true } },
    ]);
    expect(s).toMatchObject({ sort: { id: 'code', desc: true }, page: 1 });
  });

  it('đổi cỡ trang tự về trang 1', () => {
    const s = run([
      { type: 'page', page: 7 },
      { type: 'pageSize', size: 50 },
    ]);
    expect(s).toMatchObject({ pageSize: 50, page: 1 });
  });

  it('đổi trang không làm mất bộ lọc; trang luôn là số nguyên >= 1', () => {
    const s = run([
      { type: 'filter', key: 'stock', value: 'in' },
      { type: 'page', page: 3 },
    ]);
    expect(s.filters.stock).toBe('in');
    expect(s.page).toBe(3);
    expect(run([{ type: 'page', page: 0 }]).page).toBe(1);
    expect(run([{ type: 'page', page: -4 }]).page).toBe(1);
    expect(run([{ type: 'page', page: 2.9 }]).page).toBe(2);
    expect(run([{ type: 'page', page: Number.NaN }]).page).toBe(1);
  });

  it('reset về bộ lọc ban đầu, trang 1, nhưng giữ cỡ trang đang chọn', () => {
    const messy = run([
      { type: 'filter', key: 'status', value: 'inactive' },
      { type: 'q', value: 'abc' },
      { type: 'sort', sort: { id: 'name', desc: false } },
      { type: 'pageSize', size: 100 },
      { type: 'page', page: 3 },
    ]);
    expect(listStateReducer(messy, { type: 'reset', state: initial })).toEqual({
      ...initial,
      pageSize: 100,
    });
  });

  it('không sửa tại chỗ trạng thái cũ', () => {
    const before = structuredClone(initial);
    run([
      { type: 'filter', key: 'status', value: 'x' },
      { type: 'q', value: 'y' },
    ]);
    expect(initial).toEqual(before);
  });
});
