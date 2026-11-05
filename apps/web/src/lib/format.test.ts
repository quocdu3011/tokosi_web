import { describe, expect, it } from 'vitest';

import { formatDate, formatDateTime, formatDecimal, formatMoney } from './format';

describe('định dạng', () => {
  it('số thập phân dạng chuỗi', () => {
    expect(formatDecimal('1234567')).toBe('1.234.567');
    expect(formatDecimal('219967.9800')).toBe('219.967,98');
    expect(formatDecimal('-1500000')).toBe('-1.500.000');
    expect(formatDecimal('0.000')).toBe('0');
    expect(formatDecimal('-0')).toBe('0');
    // Lớn hơn Number.MAX_SAFE_INTEGER vẫn chính xác
    expect(formatDecimal('12345678901234567890')).toBe('12.345.678.901.234.567.890');
    expect(formatDecimal('abc')).toBe('abc');
  });
  it('tiền VND', () => {
    expect(formatMoney('33735000')).toBe('33.735.000 ₫');
    expect(formatMoney(null)).toBe('');
  });
  it('ngày giờ theo Asia/Ho_Chi_Minh', () => {
    expect(formatDate('2026-11-03T18:30:00.000Z')).toBe('04/11/2026');
    expect(formatDateTime('2026-11-03T07:11:16.170Z')).toBe('03/11/2026 14:11');
  });
});
