import { describe, expect, it } from 'vitest';

import { decimalSortValue, sortRows } from './table-sort';

interface R {
  id: string;
  name: string;
  price: number | null;
}
const rows: R[] = [
  { id: 'a', name: 'Đèn', price: 30 },
  { id: 'b', name: 'Bát', price: null },
  { id: 'c', name: 'Quạt', price: 5 },
  { id: 'd', name: 'Chén', price: 100 },
];
const acc = { name: (r: R) => r.name, price: (r: R) => r.price };

describe('sortRows', () => {
  it('sắp xếp số tăng dần, ô trống xuống cuối', () => {
    expect(sortRows(rows, { id: 'price', desc: false }, acc).map((r) => r.id)).toEqual([
      'c',
      'a',
      'd',
      'b',
    ]);
  });
  it('giảm dần vẫn để ô trống ở cuối', () => {
    expect(sortRows(rows, { id: 'price', desc: true }, acc).map((r) => r.id)).toEqual([
      'd',
      'a',
      'c',
      'b',
    ]);
  });
  it('sắp xếp chữ theo tiếng Việt', () => {
    expect(sortRows(rows, { id: 'name', desc: false }, acc).map((r) => r.name)).toEqual([
      'Bát',
      'Chén',
      'Đèn',
      'Quạt',
    ]);
  });
  it('không sort hoặc cột lạ thì giữ nguyên, không đổi mảng gốc', () => {
    expect(sortRows(rows, null, acc)).toBe(rows);
    expect(sortRows(rows, { id: 'x', desc: false }, acc)).toBe(rows);
    sortRows(rows, { id: 'name', desc: true }, acc);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('decimalSortValue', () => {
  it('đổi chuỗi thập phân, trống → null', () => {
    expect(decimalSortValue('1234.5000')).toBe(1234.5);
    expect(decimalSortValue('')).toBeNull();
    expect(decimalSortValue(undefined)).toBeNull();
    expect(decimalSortValue('abc')).toBeNull();
  });
});
