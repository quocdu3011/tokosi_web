import { describe, expect, it } from 'vitest';

import { parseContentDispositionFilename } from './api/client';
import { buildHtmlDocument, escapeHtml, exportFilename } from './table-export';

describe('escapeHtml', () => {
  it('thoát các ký tự đặc biệt', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    );
  });
});

describe('buildHtmlDocument', () => {
  const rows = [
    { code: 'A1', name: '<b>Quạt</b>', price: '1.000 ₫' },
    { code: 'A2', name: 'Đèn & pin', price: '2.000 ₫' },
  ];
  const html = buildHtmlDocument({
    title: 'Hàng hóa',
    subtitle: 'Hà Nội',
    columns: [
      { header: 'Mã', value: (r) => r.code },
      { header: 'Tên', value: (r) => r.name },
      { header: 'Giá', value: (r) => r.price, numeric: true },
    ],
    rows,
    generatedAt: new Date('2026-11-05T03:00:00Z'),
  });

  it('có đủ tiêu đề cột và số dòng', () => {
    expect(html).toContain('<th>Mã</th>');
    expect(html).toContain('<th class="num">Giá</th>');
    expect(html.match(/<tr><td/g)).toHaveLength(2);
    expect(html).toContain('2 dòng');
  });

  it('không để dữ liệu chèn được thẻ HTML', () => {
    expect(html).not.toContain('<b>Quạt</b>');
    expect(html).toContain('&lt;b&gt;Quạt&lt;/b&gt;');
    expect(html).toContain('Đèn &amp; pin');
  });
});

describe('exportFilename', () => {
  it('lấy ngày theo giờ Việt Nam', () => {
    // 20:00 UTC ngày 4/11 = 03:00 ngày 5/11 ở Việt Nam.
    expect(exportFilename('hang-hoa', 'html', new Date('2026-11-04T20:00:00Z'))).toBe(
      'hang-hoa-2026-11-05.html',
    );
  });
});

describe('parseContentDispositionFilename', () => {
  it('đọc dạng filename*=UTF-8', () => {
    expect(
      parseContentDispositionFilename("attachment; filename*=UTF-8''h%C3%A0ng-h%C3%B3a.xlsx"),
    ).toBe('hàng-hóa.xlsx');
  });
  it('đọc dạng filename="..."', () => {
    expect(parseContentDispositionFilename('attachment; filename="products.xlsx"')).toBe(
      'products.xlsx',
    );
  });
  it('trả null khi không có header', () => {
    expect(parseContentDispositionFilename(null)).toBeNull();
  });
});
