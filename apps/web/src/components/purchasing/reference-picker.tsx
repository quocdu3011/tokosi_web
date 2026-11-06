'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { usePurchaseList } from '@/lib/queries/purchasing';
import type { PurchaseDocument } from '@/lib/api/types';
import type { PurchaseKind } from '@/lib/purchasing';
import { QueryError } from './query-feedback';

export function ReferencePicker({
  kind,
  supplierId,
  onSelect,
}: {
  kind: Exclude<PurchaseKind, 'returns'>;
  supplierId: string;
  onSelect: (doc: PurchaseDocument) => Promise<void>;
}) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const term = useDebouncedValue(q, 250);
  const query = usePurchaseList(
    kind,
    {
      q: term,
      supplierId,
      status: kind === 'receipts' ? 'completed' : 'confirmed',
      page: 1,
      limit: 20,
    },
    !!supplierId,
  );
  const drafts = usePurchaseList(
    'orders',
    { q: term, supplierId, status: 'draft', page: 1, limit: 20 },
    kind === 'orders' && !!supplierId,
  );
  const rows = [
    ...(query.data?.data ?? []),
    ...(kind === 'orders' ? (drafts.data?.data ?? []) : []),
  ];
  return (
    <div className="stack-sm">
      <Input
        aria-label="Tìm phiếu gốc"
        placeholder={kind === 'orders' ? 'Tìm phiếu đặt còn mở…' : 'Tìm phiếu nhập hoàn tất…'}
        value={q}
        disabled={busy}
        onChange={(e) => setQ(e.target.value)}
      />
      {query.isError || (kind === 'orders' && drafts.isError) ? (
        <QueryError
          error={query.error ?? drafts.error}
          retry={() => {
            void query.refetch();
            if (kind === 'orders') void drafts.refetch();
          }}
        />
      ) : (
        <div className="purchase-picker">
          {query.isLoading && <p>Đang tải phiếu…</p>}
          {rows.map((d) => (
            <Button
              type="button"
              key={d.id}
              variant="ghost"
              disabled={
                busy || query.isPlaceholderData || (kind === 'orders' && drafts.isPlaceholderData)
              }
              onClick={async () => {
                setBusy(true);
                try {
                  await onSelect(d);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {d.code} · {d.supplier.name}
            </Button>
          ))}
          {!query.isLoading && !(kind === 'orders' && drafts.isLoading) && !rows.length && (
            <p className="muted">Không tìm thấy phiếu phù hợp.</p>
          )}
        </div>
      )}
    </div>
  );
}
