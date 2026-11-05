import { describe, expect, it } from 'vitest';

import { defaultStockRange, stockRefLabel } from './stock-card';

describe('stockRefLabel', () => {
  it('có nhãn tiếng Việt cho loại đã biết, giữ nguyên loại lạ', () => {
    expect(stockRefLabel('goods_receipt')).toBe('Nhập hàng');
    expect(stockRefLabel('transfer_in')).toBe('Nhận chuyển kho');
    expect(stockRefLabel('moi_la')).toBe('moi_la');
  });
});

describe('defaultStockRange', () => {
  it('30 ngày gần nhất theo giờ Việt Nam', () => {
    // 2026-11-05 20:00 UTC = 03:00 ngày 06/11 giờ VN
    const r = defaultStockRange(new Date('2026-11-05T20:00:00Z'));
    expect(r.to).toBe('2026-11-06');
    expect(r.from).toBe('2026-10-08');
  });
});
