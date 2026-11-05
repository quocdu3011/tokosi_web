import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { CategoryNode, CreateCategoryInput, UpdateCategoryInput } from '@/lib/api/types';
import { productKeys } from '@/lib/queries/products';

/** Nhóm hàng (`/categories`, ghi cần `product.edit`). Không có thao tác xóa trên giao diện. */

function useInvalidateCategories() {
  const qc = useQueryClient();
  // Số hàng của nhóm (và đường dẫn nhóm trên danh sách hàng) đổi theo cây nhóm.
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: productKeys.categories }),
      qc.invalidateQueries({ queryKey: productKeys.all }),
    ]);
}

export function useCreateCategory() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: (input: CreateCategoryInput) =>
      api.post<CategoryNode>('/categories', input, { branchId: null }),
    onSuccess: invalidate,
  });
}

export function useUpdateCategory() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateCategoryInput }) =>
      api.patch<CategoryNode>(`/categories/${id}`, patch, { branchId: null }),
    onSuccess: invalidate,
  });
}
