import { describe, expect, it } from 'vitest';

import { normalizePhoneDigits, passwordProblem, phoneProblem, usernameProblem } from './forms';

describe('usernameProblem', () => {
  it('chấp nhận 3–32 ký tự hợp lệ (chữ hoa được đưa về chữ thường)', () => {
    expect(usernameProblem('nguyen.van-a_1')).toBeNull();
    expect(usernameProblem('NguyenA')).toBeNull();
  });
  it('từ chối quá ngắn, có dấu, có dấu cách', () => {
    expect(usernameProblem('ab')).not.toBeNull();
    expect(usernameProblem('nguyễn')).not.toBeNull();
    expect(usernameProblem('a b c')).not.toBeNull();
  });
});

describe('phoneProblem / normalizePhoneDigits', () => {
  it('chuẩn hóa +84 về 0', () => {
    expect(normalizePhoneDigits('+84 901 234 567')).toBe('0901234567');
  });
  it('rỗng hợp lệ; số Việt Nam hợp lệ; số sai bị từ chối', () => {
    expect(phoneProblem('')).toBeNull();
    expect(phoneProblem('0901 234 567')).toBeNull();
    expect(phoneProblem('+84 901 234 567')).toBeNull();
    expect(phoneProblem('12345')).not.toBeNull();
    expect(phoneProblem('abc')).not.toBeNull();
  });
});

describe('passwordProblem', () => {
  it('đủ 10 ký tự và không chứa tên đăng nhập', () => {
    expect(passwordProblem('matkhau-manh-1', 'zz')).toBeNull();
    expect(passwordProblem('ngan', 'an')).toMatch(/10/);
    expect(passwordProblem('xxxxanxxxxxx', 'an')).toMatch(/tên đăng nhập/);
  });
});
