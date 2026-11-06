import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  Customer,
  CustomerList,
  CustomerVisit,
  CustomerTermsInput,
  CustomerLedger,
  CreateCustomerInput,
  UpdateCustomerInput,
} from '@/lib/api/types';
import { useBranchStore } from '@/lib/branch';

export interface CustomerParams {
  q?: string;
  priceLevel?: Customer['priceLevel'];
  salesOwnerId?: string;
  acquisitionSource?: string;
  newSinceFrom?: string;
  newSinceTo?: string;
  hasDebt?: boolean;
  isActive?: boolean;
  sort?: string;
  page: number;
  limit: number;
}
export function useCustomerList(params: CustomerParams, enabled: boolean) {
  const branchId = useBranchStore((s) => s.branchId);
  return useQuery({
    queryKey: ['customers', branchId, 'list', params],
    enabled: enabled && !!branchId,
    queryFn: ({ signal }) =>
      api.get<CustomerList>('/customers', { query: { ...params }, branchId, signal }),
    placeholderData: keepPreviousData,
  });
}
export function useCustomer(id: string) {
  const branchId = useBranchStore((s) => s.branchId);
  return useQuery({
    queryKey: ['customers', branchId, 'detail', id],
    queryFn: ({ signal }) => api.get<Customer>(`/customers/${id}`, { branchId, signal }),
  });
}
export function saveCustomer(
  args: { id: string; input: UpdateCustomerInput } | { id?: undefined; input: CreateCustomerInput },
  branchId: string | null,
) {
  return args.id
    ? api.patch<Customer>(`/customers/${args.id}`, args.input, { branchId })
    : api.post<Customer>('/customers', args.input, { branchId });
}
export function useSaveCustomer() {
  const branchId = useBranchStore((s) => s.branchId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: Parameters<typeof saveCustomer>[0]) => saveCustomer(args, branchId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customers'] }),
  });
}
export function useCustomerVisits(id: string) {
  return useQuery({
    queryKey: ['customers', 'visits', id],
    queryFn: ({ signal }) => api.get<CustomerVisit[]>(`/customers/${id}/visits`, { signal }),
  });
}
export function useCustomerVisitMutation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { visitedOn: string; note: string | null } | { removeId: string }) => {
      if ('removeId' in args) await api.delete(`/customers/${id}/visits/${args.removeId}`);
      else await api.post<CustomerVisit>(`/customers/${id}/visits`, args);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customers'] }),
  });
}
export function useSetCustomerTerms(id: string, branchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomerTermsInput) =>
      api.put(`/customers/${id}/branches/${branchId}/terms`, input, { branchId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customers'] }),
  });
}
export function useCustomerLedger(
  id: string,
  range: { from: string; to: string },
  enabled: boolean,
) {
  const branchId = useBranchStore((s) => s.branchId);
  return useQuery({
    queryKey: ['customers', branchId, 'ledger', id, range],
    enabled,
    queryFn: ({ signal }) =>
      api.get<CustomerLedger>(`/customers/${id}/ledger`, { query: range, branchId, signal }),
  });
}
