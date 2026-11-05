import { describe, expect, it } from 'vitest';

import { cellKey, resolveDraft, summarizeDrafts, type CellDraft } from './price-grid';

describe('resolveDraft', () => {
  it('giá trùng giá gốc → không đổi', () => {
    expect(resolveDraft('33500', '33500')).toEqual({ kind: 'same' });
    expect(resolveDraft('33500', ' 033500 ')).toEqual({ kind: 'same' });
  });

  it('giá khác → đổi, bỏ số 0 đầu', () => {
    expect(resolveDraft('33500', '34000')).toEqual({ kind: 'change', price: '34000' });
    expect(resolveDraft(null, '0050')).toEqual({ kind: 'change', price: '50' });
    expect(resolveDraft('100', '0')).toEqual({ kind: 'change', price: '0' });
  });

  it('để trống: xóa giá nếu đang có, bỏ qua nếu vốn chưa có', () => {
    expect(resolveDraft('33500', '')).toEqual({ kind: 'change', price: null });
    expect(resolveDraft('33500', '  ')).toEqual({ kind: 'change', price: null });
    expect(resolveDraft(null, '')).toEqual({ kind: 'same' });
  });

  it('số lẻ, số âm, chữ → không hợp lệ (giá bán là số nguyên đồng)', () => {
    for (const raw of ['33000.5', '33000,5', '-1', 'abc', '1e3', '1 000']) {
      expect(resolveDraft('1', raw)).toEqual({ kind: 'invalid' });
    }
  });
});

describe('summarizeDrafts', () => {
  const draft = (p: string, b: string, original: string | null, raw: string): CellDraft => ({
    productId: p,
    priceBookId: b,
    original,
    raw,
  });

  it('chỉ gửi ô thực sự đổi, đếm riêng ô sai', () => {
    const drafts = {
      [cellKey('p1', 'b1')]: draft('p1', 'b1', '100', '200'),
      [cellKey('p1', 'b2')]: draft('p1', 'b2', '100', '100'),
      [cellKey('p2', 'b1')]: draft('p2', 'b1', '100', ''),
      [cellKey('p2', 'b2')]: draft('p2', 'b2', null, '12.5'),
    };
    expect(summarizeDrafts(drafts)).toEqual({
      changes: [
        { productId: 'p1', priceBookId: 'b1', price: '200' },
        { productId: 'p2', priceBookId: 'b1', price: null },
      ],
      invalidCount: 1,
    });
  });
});
