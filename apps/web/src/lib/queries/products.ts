import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { CategoryNode, Product, ProductList } from '@/lib/api/types';
import { useBranchStore } from '@/lib/branch';

/** Truy vấn hàng hóa (`/products`, `/categories`, quyền `product.view`) — docs/api/endpoints.md mục 2. */

export interface ProductListParams {
  q?: string;
  categoryId?: string;
  isActive?: boolean;
  inStock?: boolean;
  /** `code`, `name`, `onHand`, `createdAt`; thêm `-` phía trước để giảm dần (endpoints.md mục 2.1). */
  sort?: string;
  page: number;
  limit: number;
}

/** Giới hạn của API khi xuất/lấy nhiều dòng (endpoints.md: `limit` tối đa 100, xuất tối đa 10.000 dòng). */
const MAX_PAGE_LIMIT = 100;
export const PRODUCT_EXPORT_MAX_ROWS = 10_000;

export type ProductFilterParams = Omit<ProductListParams, 'page' | 'limit'>;

/** Tải Excel theo đúng bộ lọc + sắp xếp hiện tại (server dựng file, bỏ qua page/limit). */
export function downloadProductsXlsx(filters: ProductFilterParams) {
  return api.download('/products', { query: { ...filters, format: 'xlsx' } });
}

/** Lấy mọi dòng khớp bộ lọc (từng trang 100 dòng, tối đa 10.000) để dựng file HTML. */
export async function fetchAllProducts(filters: ProductFilterParams): Promise<Product[]> {
  const rows: Product[] = [];
  for (let page = 1; rows.length < PRODUCT_EXPORT_MAX_ROWS; page++) {
    const res = await api.get<ProductList>('/products', {
      query: { ...filters, page, limit: MAX_PAGE_LIMIT },
    });
    rows.push(...res.data);
    if (page >= res.meta.totalPages || res.data.length === 0) break;
  }
  return rows.slice(0, PRODUCT_EXPORT_MAX_ROWS);
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
