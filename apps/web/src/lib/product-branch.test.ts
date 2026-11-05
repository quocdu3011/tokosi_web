import { describe, expect, it } from 'vitest';

import { branchSettingsProblem, toNullable } from './product-branch';

describe('toNullable', () => {
  it('rỗng hoặc toàn khoảng trắng → null', () => {
    expect(toNullable('')).toBeNull();
    expect(toNullable('  ')).toBeNull();
    expect(toNullable(' 10 ')).toBe('10');
  });
});

describe('branchSettingsProblem', () => {
  it('hợp lệ → null (kể cả bỏ trống một hoặc hai ô)', () => {
    expect(branchSettingsProblem('', '')).toBeNull();
    expect(branchSettingsProblem('10', '')).toBeNull();
    expect(branchSettingsProblem('', '2000')).toBeNull();
    expect(branchSettingsProblem('10', '10')).toBeNull();
    expect(branchSettingsProblem('2.5', '10.125')).toBeNull();
  });
  it('số âm, chữ, quá 3 chữ số thập phân', () => {
    expect(branchSettingsProblem('-1', '')).toMatch(/tối thiểu/);
    expect(branchSettingsProblem('', 'abc')).toMatch(/tối đa/);
    expect(branchSettingsProblem('1.2345', '')).toMatch(/tối thiểu/);
  });
  it('min lớn hơn max', () => {
    expect(branchSettingsProblem('11', '10')).toMatch(/không được lớn hơn/);
  });
});
