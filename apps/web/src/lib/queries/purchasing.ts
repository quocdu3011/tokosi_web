import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PurchaseDocument, PurchaseDocumentList } from '@/lib/api/types';
import { useBranchStore } from '@/lib/branch';
import {
  buildPurchaseInput,
  PURCHASE_CONFIG,
  type PurchaseDraft,
  type PurchaseKind,
} from '@/lib/purchasing';

export interface PurchaseParams {
  q?: string;
  supplierId?: string;
  status?: string;
  from?: string;
  to?: string;
  sort?: string;
  purchaseOrderId?: string;
  goodsReceiptId?: string;
  page: number;
  limit: number;
}
export function usePurchaseList(kind: PurchaseKind, params: PurchaseParams, enabled = true) {
  const branchId = useBranchStore((s) => s.branchId);
  return useQuery({
    queryKey: ['purchasing', branchId, kind, params],
    enabled,
    queryFn: ({ signal }) =>
      api.get<PurchaseDocumentList>(PURCHASE_CONFIG[kind].path, {
        query: { ...params },
        branchId,
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}
export function usePurchaseDocument(kind: PurchaseKind, id: string | null) {
  const branchId = useBranchStore((s) => s.branchId);
  return useQuery({
    queryKey: ['purchasing', branchId, kind, id],
    enabled: !!id,
    queryFn: ({ signal }) =>
      api.get<PurchaseDocument>(`${PURCHASE_CONFIG[kind].path}/${id}`, { branchId, signal }),
  });
}
export function createPurchase(
  kind: PurchaseKind,
  draft: PurchaseDraft,
  idempotencyKey: string,
  branchId: string | null,
) {
  return api.post<PurchaseDocument>(PURCHASE_CONFIG[kind].path, buildPurchaseInput(kind, draft), {
    idempotencyKey,
    branchId,
  });
}
export function usePurchaseMutation(kind: PurchaseKind) {
  const branchId = useBranchStore((s) => s.branchId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      args:
        | { action: 'create'; draft: PurchaseDraft; key: string }
        | { action: 'update'; id: string; draft: PurchaseDraft }
        | { action: 'note'; id: string; note: string }
        | { action: 'confirm' | 'complete' | 'cancel'; id: string; reason?: string },
    ) => {
      const path = PURCHASE_CONFIG[kind].path;
      if (args.action === 'create') return createPurchase(kind, args.draft, args.key, branchId);
      if (args.action === 'update')
        return api.put<PurchaseDocument>(
          `${path}/${args.id}`,
          buildPurchaseInput('orders', args.draft),
          { branchId },
        );
      if (args.action === 'note')
        return api.patch<PurchaseDocument>(
          `${path}/${args.id}`,
          { note: args.note || null },
          { branchId },
        );
      return api.post<PurchaseDocument>(
        `${path}/${args.id}/${args.action}`,
        args.action === 'cancel' ? { reason: args.reason || undefined } : {},
        { branchId },
      );
    },
    onSettled: () =>
      Promise.all(
        ['purchasing', 'suppliers', 'products'].map((key) =>
          qc.invalidateQueries({ queryKey: [key] }),
        ),
      ),
  });
}
