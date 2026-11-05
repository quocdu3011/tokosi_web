import type { CategoryNode } from '@/lib/api/types';

/** Cây nhóm hàng tối đa 3 cấp (docs/api/endpoints.md mục 2.1). */
export const MAX_CATEGORY_DEPTH = 3;

export interface ParentOption {
  id: string;
  name: string;
  /** Cấp của nhóm này, bắt đầu từ 1 (nhóm gốc). */
  level: number;
}

/** Chiều cao cây con: nhóm không có con = 1. */
export function subtreeHeight(node: Pick<CategoryNode, 'children'>): number {
  if (node.children.length === 0) return 1;
  return 1 + Math.max(...node.children.map((c) => subtreeHeight(c)));
}

/** Tìm một nhóm theo id trong cây. */
export function findCategory(nodes: CategoryNode[], id: string): CategoryNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findCategory(n.children, id);
    if (found) return found;
  }
  return null;
}

/**
 * Các nhóm cha chọn được khi tạo nhóm mới (`editing = null`) hoặc chuyển nhóm `editing`:
 * loại chính nó và mọi nhóm con, và loại nhóm nào làm cây con vượt 3 cấp.
 * Chọn "nhóm gốc" (không có cha) luôn được, nên không nằm trong danh sách này.
 */
export function parentOptions(tree: CategoryNode[], editing: CategoryNode | null): ParentOption[] {
  const height = editing ? subtreeHeight(editing) : 1;
  const out: ParentOption[] = [];
  const walk = (nodes: CategoryNode[], level: number) => {
    for (const n of nodes) {
      if (editing && n.id === editing.id) continue; // bỏ luôn cả nhánh con của nó
      if (level + height <= MAX_CATEGORY_DEPTH) out.push({ id: n.id, name: n.name, level });
      walk(n.children, level + 1);
    }
  };
  walk(tree, 1);
  return out;
}
