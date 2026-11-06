import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  CategoryNode,
  CreateProductInput,
  Product,
  ProductList,
  ProductLookup,
  StockCard,
  UpdateProductInput,
} from '@/lib/api/types';
import { useBranchStore } from '@/lib/branch';

/** Truy vấn hàng hóa (`/products`, `/categories`, quyền `product.view`) — docs/api/endpoints.md mục 2. */

export interface ProductListParams {
  q?: string;
  categoryId?: string;
  isActive?: boolean;
  inStock?: boolean;
  productType?: Product['productType'];
  liquidationStatus?: Product['liquidationStatus'];
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
  detail: (branchId: string | null, id: string) => ['products', 'detail', branchId, id] as const,
  stockCard: (branchId: string | null, id: string, from: string, to: string) =>
    ['products', 'stock-card', branchId, id, from, to] as const,
  lookup: (branchId: string | null, q: string) => ['products', 'lookup', branchId, q] as const,
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

/** Chi tiết một hàng (tồn, giá vốn tính cho chi nhánh làm việc). Tắt khi `id` là `null` (đang tạo mới). */
export function useProduct(id: string | null) {
  const branchId = useBranchStore((s) => s.branchId);
  return useQuery({
    queryKey: productKeys.detail(branchId, id ?? ''),
    enabled: id !== null,
    queryFn: ({ signal }) => api.get<Product>(`/products/${id}`, { signal }),
  });
}

/** Thay đổi hàng hóa ảnh hưởng danh sách, chi tiết, thẻ kho… → làm mới mọi truy vấn `products`. */
function useInvalidateProducts() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: productKeys.all });
}

export function useCreateProduct() {
  const invalidate = useInvalidateProducts();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProductInput) => api.post<Product>('/products', input),
    onSuccess: () => {
      // Tạo hàng có thể kèm nhóm mới/đổi số đếm của nhóm.
      void qc.invalidateQueries({ queryKey: productKeys.categories });
      return invalidate();
    },
  });
}

export function useUpdateProduct() {
  const invalidate = useInvalidateProducts();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateProductInput }) =>
      api.patch<Product>(`/products/${id}`, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: productKeys.categories });
      return invalidate();
    },
  });
}

/** Thẻ kho tại chi nhánh làm việc; `from`/`to` dạng `YYYY-MM-DD` (giờ Việt Nam). Combo không có thẻ kho. */
export function useStockCard(
  id: string | null,
  range: { from: string; to: string },
  enabled = true,
) {
  const branchId = useBranchStore((s) => s.branchId);
  return useQuery({
    queryKey: productKeys.stockCard(branchId, id ?? '', range.from, range.to),
    enabled: id !== null && enabled,
    queryFn: ({ signal }) =>
      api.get<StockCard>(`/products/${id}/stock-card`, { query: range, signal }),
  });
}

/** Tìm nhanh để chọn hàng thành phần (tối đa 20 dòng). Chỉ gọi khi đã gõ ít nhất 1 ký tự. */
export function useProductLookup(q: string) {
  const branchId = useBranchStore((s) => s.branchId);
  const term = q.trim();
  return useQuery({
    queryKey: productKeys.lookup(branchId, term),
    enabled: term.length > 0,
    queryFn: ({ signal }) =>
      api.get<ProductLookup[]>('/products/lookup', { query: { q: term }, signal }),
    staleTime: 30_000,
  });
}
