import { describe, expect, it } from 'vitest';
import { formatDocumentCode } from './codes.js';
import { formatVnd } from './money.js';

describe('formatDocumentCode', () => {
  it('đệm số 0 đến 6 chữ số', () => {
    expect(formatDocumentCode('HD', 16890)).toBe('HD016890');
    expect(formatDocumentCode('KH', 7)).toBe('KH000007');
    expect(formatDocumentCode('NV', 1, 4)).toBe('NV0001');
  });
});

describe('formatVnd', () => {
  it('hiển thị phân cách hàng nghìn và ký hiệu đồng', () => {
    const text = formatVnd(1234567).replace(/\s/g, ' ');
    expect(text).toContain('1.234.567');
    expect(text).toContain('₫');
  });
});
