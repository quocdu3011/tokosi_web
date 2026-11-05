import { describe, expect, it } from 'vitest';

import { componentsProblem, parseComponents, serializeComponents } from './product-components';

describe('parse/serializeComponents', () => {
  it('khứ hồi và bỏ khoảng trắng', () => {
    const rows = parseComponents(' DAO01/2 , KEO03/1 ');
    expect(rows).toEqual([
      { code: 'DAO01', qty: 2 },
      { code: 'KEO03', qty: 1 },
    ]);
    expect(serializeComponents(rows)).toBe('DAO01/2,KEO03/1');
  });
  it('chuỗi rỗng → không có dòng', () => {
    expect(parseComponents('')).toEqual([]);
    expect(serializeComponents([])).toBe('');
  });
  it('dòng thiếu số lượng được đánh dấu qty 0', () => {
    expect(parseComponents('DAO01')).toEqual([{ code: 'DAO01', qty: 0 }]);
  });
});

describe('componentsProblem', () => {
  it('hợp lệ → null', () => {
    expect(componentsProblem([{ code: 'A', qty: 1 }])).toBeNull();
  });
  it('rỗng, thiếu mã, số lượng sai, trùng mã', () => {
    expect(componentsProblem([])).toMatch(/ít nhất/);
    expect(componentsProblem([{ code: '', qty: 1 }])).toMatch(/chưa chọn/);
    expect(componentsProblem([{ code: 'A', qty: 0 }])).toMatch(/nguyên dương/);
    expect(componentsProblem([{ code: 'A', qty: 1.5 }])).toMatch(/nguyên dương/);
    expect(
      componentsProblem([
        { code: 'A', qty: 1 },
        { code: 'a', qty: 2 },
      ]),
    ).toMatch(/lặp/);
  });
});
