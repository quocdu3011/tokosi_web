import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  CreateSupplierInput,
  Supplier,
  SupplierBranch,
  SupplierLedger,
  SupplierList,
  UpdateSupplierInput,
} from '@/lib/api/types';
import { useBranchStore } from '@/lib/branch';

export interface SupplierParams {
  q?: string;
  groupName?: string;
  hasDebt?: boolean;
  isActive?: boolean;
  sort?: string;
  page: number;
  limit: number;
}
export function useSupplierList(params: SupplierParams) {
  const branchId = useBranchStore((s) => s.branchId);
  return useQuery({
    queryKey: ['suppliers', branchId, params],
    queryFn: ({ signal }) =>
      api.get<SupplierList>('/suppliers', { query: { ...params }, branchId, signal }),
    placeholderData: keepPreviousData,
  });
}
export function useSupplier(id: string | null) {
  const branchId = useBranchStore((s) => s.branchId);
  return useQuery({
    queryKey: ['suppliers', branchId, id],
    enabled: !!id,
    queryFn: ({ signal }) => api.get<Supplier>(`/suppliers/${id}`, { branchId, signal }),
  });
}
export function useSupplierBranches(id: string | null) {
  const branchId = useBranchStore((s) => s.branchId);
  return useQuery({
    queryKey: ['suppliers', 'branches', branchId, id],
    enabled: !!id,
    queryFn: ({ signal }) => api.get<SupplierBranch[]>(`/suppliers/${id}/branches`, { signal }),
  });
}
export function useSupplierLedger(
  id: string | null,
  range: { from: string; to: string },
  enabled: boolean,
) {
  const branchId = useBranchStore((s) => s.branchId);
  return useQuery({
    queryKey: ['suppliers', 'ledger', branchId, id, range],
    enabled: !!id && enabled,
    queryFn: ({ signal }) =>
      api.get<SupplierLedger>(`/suppliers/${id}/ledger`, { query: range, branchId, signal }),
  });
}
export function useSaveSupplier() {
  const qc = useQueryClient();
  const branchId = useBranchStore((s) => s.branchId);
  return useMutation({
    mutationFn: (
      args:
        { id: string; input: UpdateSupplierInput } | { id?: undefined; input: CreateSupplierInput },
    ) =>
      args.id
        ? api.patch<Supplier>(`/suppliers/${args.id}`, args.input, { branchId })
        : api.post<Supplier>('/suppliers', args.input, { branchId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}
