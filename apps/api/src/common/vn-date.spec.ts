import { describe, expect, it } from 'vitest';
import { formatVnDateTime, vnDayStart } from './vn-date.js';

describe('vnDayStart', () => {
  it('00:00 giờ Việt Nam = 17:00 UTC của ngày hôm trước', () => {
    expect(vnDayStart('2026-11-03', 'from').toISOString()).toBe(
      '2026-11-02T17:00:00.000Z',
    );
    expect(vnDayStart('2024-02-29', 'from').toISOString()).toBe(
      '2024-02-28T17:00:00.000Z',
    ); // năm nhuận
  });
  it('ngày không có thật hoặc sai dạng → 400, không tự đổi sang ngày khác', () => {
    for (const bad of [
      '2026-02-31',
      '2026-02-29',
      '2026-13-01',
      '2026-00-10',
      '2026-04-31',
      '2026-1-1',
      'abc',
      '',
    ]) {
      expect(() => vnDayStart(bad, 'from'), bad).toThrow(/Ngày không hợp lệ/);
    }
  });
});

describe('formatVnDateTime', () => {
  it('đổi UTC sang giờ Việt Nam, qua ngày mới', () => {
    expect(formatVnDateTime(new Date('2026-11-02T17:30:00Z'))).toBe(
      '03/11/2026 00:30',
    );
    expect(formatVnDateTime(new Date('2026-12-31T16:59:00Z'))).toBe(
      '31/12/2026 23:59',
    );
  });
});
