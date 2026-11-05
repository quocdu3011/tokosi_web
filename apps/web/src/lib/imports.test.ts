import { describe, expect, it } from 'vitest';

import {
  IMPORT_MAX_BYTES,
  importOutcome,
  isModeSupported,
  summarizeImport,
  validateImportFile,
} from './imports';

describe('validateImportFile', () => {
  it('nhận .xlsx (không phân biệt hoa thường)', () => {
    expect(validateImportFile({ name: 'SanPham.XLSX', size: 1000 })).toBeNull();
  });
  it('từ chối đuôi khác, file rỗng, file quá lớn', () => {
    expect(validateImportFile({ name: 'a.csv', size: 10 })).toMatch(/\.xlsx/);
    expect(validateImportFile({ name: 'a.xls', size: 10 })).toMatch(/\.xlsx/);
    expect(validateImportFile({ name: 'a.xlsx', size: 0 })).toMatch(/rỗng/);
    expect(validateImportFile({ name: 'a.xlsx', size: IMPORT_MAX_BYTES + 1 })).toMatch(/10 MB/);
    expect(validateImportFile({ name: 'a.xlsx', size: IMPORT_MAX_BYTES })).toBeNull();
  });
});

describe('isModeSupported', () => {
  it('import đè luôn dùng được', () => {
    expect(isModeSupported('products', 'overwrite')).toBe(true);
    expect(isModeSupported('price-books', 'overwrite')).toBe(true);
  });
  it('import thêm bị khóa tới khi API hỗ trợ (tránh ghi đè nhầm số lượng)', () => {
    expect(isModeSupported('products', 'add')).toBe(false);
    expect(isModeSupported('price-books', 'add')).toBe(false);
  });
});

describe('importOutcome / summarizeImport', () => {
  it('hoàn tất không lỗi → ok', () => {
    expect(importOutcome({ status: 'completed', failed: 0, errors: [] })).toBe('ok');
  });
  it('có dòng lỗi hoặc failed → has-errors', () => {
    expect(
      importOutcome({
        status: 'failed',
        failed: 1,
        errors: [{ row: 2, field: 'Mã hàng', message: 'x' }],
      }),
    ).toBe('has-errors');
    expect(importOutcome({ status: 'failed', failed: 0, errors: [] })).toBe('has-errors');
  });
  it('tóm tắt có dấu phân cách nghìn', () => {
    const text = summarizeImport({ created: 2700, updated: 87, total: 2787 });
    expect(text).toContain('Thêm mới');
    expect(text).toContain('87');
    expect(text.replace(/\D/g, '')).toBe('2700872787');
  });
});
