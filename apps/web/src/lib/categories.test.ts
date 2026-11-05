import { describe, expect, it } from 'vitest';

import type { CategoryNode } from '@/lib/api/types';

import { findCategory, parentOptions, subtreeHeight } from './categories';

const node = (id: string, children: CategoryNode[] = []): CategoryNode => ({
  id,
  name: id,
  parentId: null,
  productCount: 0,
  children,
});

// A
// ├─ B
// │  └─ C
// └─ D
// E
const tree = [node('A', [node('B', [node('C')]), node('D')]), node('E')];

describe('subtreeHeight / findCategory', () => {
  it('đếm chiều cao cây con', () => {
    expect(subtreeHeight(tree[1]!)).toBe(1);
    expect(subtreeHeight(tree[0]!)).toBe(3);
  });
  it('tìm theo id ở mọi cấp', () => {
    expect(findCategory(tree, 'C')?.id).toBe('C');
    expect(findCategory(tree, 'zzz')).toBeNull();
  });
});

describe('parentOptions', () => {
  it('tạo nhóm mới: chỉ cấp 1 và 2 làm cha được (cấp 3 sẽ vượt giới hạn)', () => {
    expect(parentOptions(tree, null).map((o) => o.id)).toEqual(['A', 'B', 'D', 'E']);
  });
  it('chuyển nhóm lá D: không chọn chính nó, được chọn cấp 1 và 2', () => {
    const d = findCategory(tree, 'D')!;
    expect(parentOptions(tree, d).map((o) => o.id)).toEqual(['A', 'B', 'E']);
  });
  it('chuyển nhóm có con (B, cao 2): loại B, con của B; cha chỉ ở cấp 1', () => {
    const b = findCategory(tree, 'B')!;
    expect(parentOptions(tree, b).map((o) => o.id)).toEqual(['A', 'E']);
  });
  it('chuyển nhóm gốc có cây cao 3 (A): không có cha hợp lệ nào', () => {
    const a = findCategory(tree, 'A')!;
    expect(parentOptions(tree, a)).toEqual([]);
  });
});
