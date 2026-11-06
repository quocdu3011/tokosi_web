import { describe, expect, it } from 'vitest';
import { parseVnDate, splitPhones } from './customers.importer.js';

describe('splitPhones (ô điện thoại của file TKS)', () => {
  it('một số, bỏ khoảng trắng/dấu chấm, đổi +84', () => {
    expect(splitPhones('0901 234 567')).toEqual(['0901234567']);
    expect(splitPhones('0901.234.567')).toEqual(['0901234567']);
    expect(splitPhones("+84 901 234 567")).toEqual(['0901234567']);
    expect(splitPhones('901234567')).toEqual(['0901234567']); // thiếu số 0 đầu
  });
  it('nhiều số ngăn bằng / , ; hoặc dính liền (20/30 chữ số)', () => {
    expect(splitPhones('0901111222 / 0988333444')).toEqual(['0901111222', '0988333444']);
    expect(splitPhones('0901111222,0988333444;0977000111')).toEqual(['0901111222', '0988333444', '0977000111']);
    expect(splitPhones('09011122220988333444')).toEqual(['0901112222', '0988333444']);
    expect(splitPhones('090111222209883334440977000111')).toEqual(['0901112222', '0988333444', '0977000111']);
  });
  it('có nhãn tên hoặc chữ thừa', () => {
    expect(splitPhones('Cường: 035.466.0707/ Quang: 0348058821')).toEqual(['0354660707', '0348058821']);
    expect(splitPhones('dạ 0329 823 483')).toEqual(['0329823483']);
  });
  it('số rác → không có số hợp lệ; bỏ trùng', () => {
    expect(splitPhones('555')).toEqual([]);
    expect(splitPhones('0')).toEqual([]);
    expect(splitPhones('085454567881')).toEqual([]);
    expect(splitPhones('0901111222 / 0901111222')).toEqual(['0901111222']);
  });
});

describe('parseVnDate', () => {
  it('nhận dd/mm/yyyy, d/m/yyyy, yyyy-mm-dd, số ngày của Excel; từ chối ngày không tồn tại', () => {
    expect(parseVnDate('05/11/2026')).toBe('2026-11-05');
    expect(parseVnDate('5/1/2026')).toBe('2026-01-05');
    expect(parseVnDate('2026-11-05')).toBe('2026-11-05');
    expect(parseVnDate(46331)).toBe('2026-11-05');
    expect(parseVnDate('30/02/2026')).toBeNull();
    expect(parseVnDate('abc')).toBeNull();
  });
});
