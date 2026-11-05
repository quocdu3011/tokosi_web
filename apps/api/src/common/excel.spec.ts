import { describe, expect, it } from 'vitest';
import { normalizeHeader, readSheet, writeSheet } from './excel.js';

describe('excel', () => {
  it('normalizeHeader: bỏ dấu, hạ chữ thường, gộp khoảng trắng', () => {
    expect(normalizeHeader('  Nhóm hàng(3 Cấp) ')).toBe('nhom hang(3 cap)');
    expect(normalizeHeader('Đơn   vị tính')).toBe('don vi tinh');
    expect(normalizeHeader('Hình ảnh (url1,url2...)')).toBe(
      'hinh anh (url1,url2...)',
    );
  });

  it('ghi rồi đọc lại: giữ kiểu số/chuỗi, bỏ dòng trống, ô trống là null', async () => {
    const buf = await writeSheet(
      'Hàng hóa',
      [{ header: 'Mã hàng' }, { header: 'Giá bán' }, { header: 'Ghi chú' }],
      [
        ['A1', 33500, 'Có dấu tiếng Việt'],
        [null, null, null],
        ['A2', 1200.5, null],
      ],
    );
    const parsed = await readSheet(buf);
    expect(parsed.headers).toEqual(['ma hang', 'gia ban', 'ghi chu']);
    expect(parsed.rows).toEqual([
      {
        row: 2,
        values: {
          'ma hang': 'A1',
          'gia ban': 33500,
          'ghi chu': 'Có dấu tiếng Việt',
        },
      },
      {
        row: 4,
        values: { 'ma hang': 'A2', 'gia ban': 1200.5, 'ghi chu': null },
      },
    ]);
  });

  it('file không phải xlsx → ném lỗi (không treo, không trả dữ liệu rác)', async () => {
    await expect(
      readSheet(Buffer.from('đây không phải xlsx')),
    ).rejects.toThrow();
  });
});
