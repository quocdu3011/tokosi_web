import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { ProductImage } from '@/lib/api/types';
import { productKeys } from '@/lib/queries/products';

/** Ảnh hàng hóa (`/products/:id/images…`, quyền `product.edit` hoặc `product.content.edit`). */

function useInvalidateProducts() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: productKeys.all });
}

/** Tải nhiều ảnh một lần (field `files` lặp lại). Trả TOÀN BỘ ảnh của hàng sau khi thêm. */
export function useUploadImages() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: ({ id, files }: { id: string; files: File[] }) => {
      const body = new FormData();
      for (const f of files) body.append('files', f);
      return api.post<ProductImage[]>(`/products/${id}/images`, body);
    },
    onSuccess: invalidate,
  });
}

/** Gửi ĐỦ id mọi ảnh của hàng theo thứ tự mới; ảnh đầu là ảnh đại diện. */
export function useReorderImages() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: ({ id, imageIds }: { id: string; imageIds: string[] }) =>
      api.put<ProductImage[]>(`/products/${id}/images/order`, { imageIds }),
    onSuccess: invalidate,
  });
}

export function useDeleteImage() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: ({ id, imageId }: { id: string; imageId: string }) =>
      api.delete(`/products/${id}/images/${imageId}`),
    onSuccess: invalidate,
  });
}
