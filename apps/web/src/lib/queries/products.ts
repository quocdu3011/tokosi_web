import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { CategoryNode, ProductList } from '@/lib/api/types';
import { useBranchStore } from '@/lib/branch';

/** Truy vấn hàng hóa (`/products`, `/categories`, quyền `product.view`) — docs/api/endpoints.md mục 2. */

export interface ProductListParams {
  q?: string;
  categoryId?: string;
  isActive?: boolean;
  inStock?: boolean;
  page: number;
  limit: number;
}

export const productKeys = {
  all: ['products'] as const,
  // Giá, tồn kho, giá vốn là DỮ LIỆU THEO CHI NHÁNH → khóa truy vấn phải gồm chi nhánh làm việc.
  list: (branchId: string | null, p: ProductListParams) =>
    ['products', 'list', branchId, p] as const,
  categories: ['categories'] as const,
};

export function useProductList(params: ProductListParams) {
  const branchId = useBranchStore((s) => s.branchId);
  return useQuery({
    queryKey: productKeys.list(branchId, params),
    queryFn: ({ signal }) => api.get<ProductList>('/products', { query: { ...params }, signal }),
    placeholderData: keepPreviousData,
  });
}

/** Cây nhóm hàng (dùng chung mọi chi nhánh). */
export function useCategories() {
  return useQuery({
    queryKey: productKeys.categories,
    queryFn: ({ signal }) => api.get<CategoryNode[]>('/categories', { signal, branchId: null }),
    staleTime: 5 * 60_000,
  });
}

/** Làm phẳng cây nhóm hàng thành danh sách có độ sâu để đưa vào ô chọn. */
export function flattenCategories(
  nodes: CategoryNode[],
  depth = 0,
): { id: string; name: string; depth: number }[] {
  return nodes.flatMap((n) => [
    { id: n.id, name: n.name, depth },
    ...flattenCategories(n.children as CategoryNode[], depth + 1),
  ]);
}
