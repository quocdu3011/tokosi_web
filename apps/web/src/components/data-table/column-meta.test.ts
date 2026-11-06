import { describe, expect, it } from 'vitest';

import {
  columnSpecs,
  DEFAULT_COLUMN_WIDTH,
  PAGE_SORT_HINT,
  sortHintsOf,
  sortableIdsOf,
  type ColumnLike,
} from './column-meta';

const columns: ColumnLike[] = [
  { id: 'code', meta: { label: 'Mã hàng', width: 120, locked: true, sort: 'server' } },
  { id: 'name', meta: { label: 'Tên hàng', width: 320, sort: 'server' } },
  { id: 'cost', meta: { label: 'Giá vốn', sort: 'page' } },
  {
    id: 'desc',
    meta: { label: 'Mô tả', hiddenByDefault: true, sort: 'page', sortHint: 'Chỉ trong trang' },
  },
  { id: 'bare' },
  { meta: { label: 'Không id' } },
];

describe('columnSpecs', () => {
  it('điền giá trị mặc định: độ rộng 160, không ẩn, không khóa, nhãn = id', () => {
    const specs = columnSpecs(columns);
    expect(specs.map((s) => s.id)).toEqual(['code', 'name', 'cost', 'desc', 'bare']);
    expect(specs[2]).toEqual({
      id: 'cost',
      label: 'Giá vốn',
      width: DEFAULT_COLUMN_WIDTH,
      hiddenByDefault: false,
      locked: false,
    });
    expect(specs[4]).toMatchObject({ id: 'bare', label: 'bare', width: 160 });
  });

  it('đọc đúng khóa/ẩn mặc định/độ rộng', () => {
    const [code, , , desc] = columnSpecs(columns);
    expect(code).toMatchObject({ locked: true, width: 120 });
    expect(desc).toMatchObject({ hiddenByDefault: true });
  });

  it('bỏ cột trùng id (giữ cột đầu)', () => {
    const specs = columnSpecs([
      { id: 'a', meta: { label: 'A1' } },
      { id: 'a', meta: { label: 'A2' } },
    ]);
    expect(specs).toHaveLength(1);
    expect(specs[0]?.label).toBe('A1');
  });
});

describe('sortableIdsOf / sortHintsOf', () => {
  it('liệt kê cột sắp xếp được, lọc theo loại server/page', () => {
    expect(sortableIdsOf(columns)).toEqual(['code', 'name', 'cost', 'desc']);
    expect(sortableIdsOf(columns, 'server')).toEqual(['code', 'name']);
    expect(sortableIdsOf(columns, 'page')).toEqual(['cost', 'desc']);
  });

  it('gợi ý: cột page có gợi ý mặc định, sortHint riêng được ưu tiên, cột server không có', () => {
    expect(sortHintsOf(columns)).toEqual({ cost: PAGE_SORT_HINT, desc: 'Chỉ trong trang' });
  });
});
