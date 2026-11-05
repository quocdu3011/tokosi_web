import { describe, expect, it } from 'vitest';
import {
  LIQUIDATION_STATUSES,
  LIQUIDATION_STATUS_LABELS,
  formatComponents,
  parseComponents,
} from './products.js';

describe('parseComponents', () => {
  it('đọc MSP/SL,MSP/SL và bỏ khoảng trắng thừa', () => {
    expect(parseComponents(' DAO01/2 , KEO03/1 ')).toEqual({
      ok: true,
      items: [
        { code: 'DAO01', qty: 2 },
        { code: 'KEO03', qty: 1 },
      ],
    });
  });
  it('rỗng → danh sách rỗng', () => {
    expect(parseComponents('  ')).toEqual({ ok: true, items: [] });
  });
  it('từ chối sai cú pháp, số lượng không nguyên dương, mã lặp', () => {
    for (const bad of [
      'DAO01',
      'DAO01/',
      '/2',
      'DAO01/0',
      'DAO01/-1',
      'DAO01/1.5',
      'DAO01/abc',
      'DAO01/2,',
      'DAO01/1,dao01/2',
      'A/1000000',
    ]) {
      expect(parseComponents(bad).ok, bad).toBe(false);
    }
  });
  it('format là nghịch đảo của parse', () => {
    const r = parseComponents('A/2,B-1/10');
    expect(r.ok && formatComponents(r.items)).toBe('A/2,B-1/10');
  });
});

describe('trạng thái thanh lý', () => {
  it('có đủ 5 trạng thái, mỗi trạng thái một nhãn tiếng Việt khác nhau', () => {
    expect(LIQUIDATION_STATUSES).toHaveLength(5);
    const labels = LIQUIDATION_STATUSES.map((s) => LIQUIDATION_STATUS_LABELS[s]);
    expect(labels).toEqual(['Thường', 'Thanh Lý', 'Tắt Mã', 'Tồn Cao', 'Tồn Ưu Tiên']);
    expect(new Set(labels).size).toBe(5);
  });
});
