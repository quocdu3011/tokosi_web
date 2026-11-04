import { describe, expect, it } from 'vitest';
import { normalizeVnPhone } from './phone.js';

describe('normalizeVnPhone', () => {
  it('bỏ khoảng trắng, dấu chấm, gạch ngang, ngoặc', () => {
    expect(normalizeVnPhone('0901 234 567')).toBe('0901234567');
    expect(normalizeVnPhone(' 0901.234.567 ')).toBe('0901234567');
    expect(normalizeVnPhone('(090)-123-4567')).toBe('0901234567');
  });

  it('đổi đầu số quốc tế +84 / 84 thành 0', () => {
    expect(normalizeVnPhone('+84 901 234 567')).toBe('0901234567');
    expect(normalizeVnPhone('84901234567')).toBe('0901234567');
  });

  it('chấp nhận số 11 chữ số (máy bàn), từ chối quá ngắn / quá dài / có chữ / không bắt đầu bằng 0', () => {
    expect(normalizeVnPhone('02838123456')).toBe('02838123456');
    expect(normalizeVnPhone('12345')).toBeNull();
    expect(normalizeVnPhone('090123456')).toBeNull(); // 9 chữ số
    expect(normalizeVnPhone('090123456789')).toBeNull(); // 12 chữ số
    expect(normalizeVnPhone('0901abc567')).toBeNull();
    expect(normalizeVnPhone('901234567')).toBeNull();
    expect(normalizeVnPhone('')).toBeNull();
  });
});
