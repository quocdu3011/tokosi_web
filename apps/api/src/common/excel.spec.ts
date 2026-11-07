import JSZip from 'jszip';
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

  it('đọc được file XML có tiền tố namespace "x:" và đường dẫn tuyệt đối (kiểu file SoQuy của KiotViet)', async () => {
    const buf = await writeSheet('S', [{ header: 'Mã' }, { header: 'Giá trị' }], [['A', 5]]);
    const zip = await JSZip.loadAsync(buf);
    for (const name of ['xl/styles.xml', 'xl/worksheets/sheet1.xml']) {
      const xml = await zip.file(name)!.async('string');
      zip.file(
        name,
        xml
          .replace(/<(\/?)([A-Za-z]\w*)(?![\w:])/g, '<$1x:$2')
          .replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'),
      );
    }
    // tham chiếu bảng bằng thuộc tính p3:id (không phải r:id) như file KiotViet
    const sheetXml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    zip.file(
      'xl/worksheets/sheet1.xml',
      sheetXml.replace(
        '</x:worksheet>',
        '<x:tableParts count="1"><x:tablePart p3:id="R1" xmlns:p3="http://schemas.openxmlformats.org/officeDocument/2006/relationships" /></x:tableParts></x:worksheet>',
      ),
    );
    const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
    zip.file('xl/_rels/workbook.xml.rels', rels.replace(/Target="(?:\/xl\/)?/g, 'Target="/xl/'));
    const odd = await zip.generateAsync({ type: 'nodebuffer' });
    const parsed = await readSheet(odd);
    expect(parsed.headers).toEqual(['ma', 'gia tri']);
    expect(parsed.rows).toEqual([{ row: 2, values: { ma: 'A', 'gia tri': 5 } }]);
  });
});
