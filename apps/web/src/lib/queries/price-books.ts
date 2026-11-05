import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  BulkAdjustInput,
  BulkAdjustResult,
  CopyBranchInput,
  CopyBranchResult,
  PriceGrid,
  SaveGridResult,
} from '@/lib/api/types';
import { useBranchStore } from '@/lib/branch';
import type { GridChange } from '@/lib/price-grid';

/** Thiết lập giá (`/price-books…`): xem cần `product.view`, ghi cần `price.edit` — endpoints.md 2.3. */

export interface PriceGridParams {
  q?: string;
  categoryId?: string;
  page: number;
  limit: number;
}

export const priceKeys = {
  all: ['price-grid'] as const,
  // Số tiền từng ô giá là RIÊNG TỪNG CHI NHÁNH → khóa truy vấn gồm chi nhánh.
  grid: (branchId: string | null, p: PriceGridParams) => ['price-grid', branchId, p] as const,
};

export function usePriceGrid(params: PriceGridParams) {
  const branchId = useBranchStore((s) => s.branchId);
  return useQuery({
    queryKey: priceKeys.grid(branchId, params),
    enabled: branchId !== null,
    queryFn: ({ signal }) =>
      api.get<PriceGrid>('/price-books/grid', {
        // Gửi rõ `branchId` (ngoài header) để chắc chắn đúng chi nhánh đang hiển thị.
        query: { ...params, branchId },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

/** Giá đổi ảnh hưởng cả lưới giá lẫn cột "Giá bán" của danh sách hàng hóa. */
function useInvalidatePrices() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: priceKeys.all }),
      qc.invalidateQueries({ queryKey: ['products'] }),
    ]);
}

export function useSaveGrid() {
  const invalidate = useInvalidatePrices();
  return useMutation({
    mutationFn: (args: { branchId: string; changes: GridChange[] }) =>
      api.put<SaveGridResult>('/price-books/grid', args),
    onSuccess: invalidate,
  });
}

/** `dryRun: true` chỉ xem trước (không lưu); `false` lưu thật. */
export function useBulkAdjust() {
  const invalidate = useInvalidatePrices();
  return useMutation({
    mutationFn: (input: BulkAdjustInput) =>
      api.post<BulkAdjustResult>('/price-books/bulk-adjust', input),
    onSuccess: (res) => (res.dryRun ? undefined : invalidate()),
  });
}

export function useCopyBranch() {
  const invalidate = useInvalidatePrices();
  return useMutation({
    mutationFn: (input: CopyBranchInput) =>
      api.post<CopyBranchResult>('/price-books/copy-branch', input),
    onSuccess: invalidate,
  });
}
