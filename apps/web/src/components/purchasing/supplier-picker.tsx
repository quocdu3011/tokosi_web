'use client';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useSupplierList } from '@/lib/queries/suppliers';
import { QueryError } from './query-feedback';

export function SupplierPicker({
  value,
  onChange,
  activeOnly = false,
}: {
  value: { id: string; name: string } | null;
  onChange: (value: { id: string; name: string } | null) => void;
  activeOnly?: boolean;
}) {
  const [q, setQ] = useState('');
  const term = useDebouncedValue(q, 250);
  const query = useSupplierList({
    q: term,
    isActive: activeOnly ? true : undefined,
    page: 1,
    limit: 20, // cố ý: danh sách chọn nhanh trong ô thả xuống, không phải trang danh sách
  });
  if (value)
    return (
      <div className="cell-badges">
        <span>{value.name}</span>
        <Button type="button" size="sm" variant="outline" onClick={() => onChange(null)}>
          Đổi nhà cung cấp
        </Button>
      </div>
    );
  return (
    <div className="stack-sm">
      <Input
        aria-label="Tìm nhà cung cấp"
        placeholder="Tìm tên hoặc mã nhà cung cấp…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {query.isError ? (
        <QueryError error={query.error} retry={query.refetch} />
      ) : (
        <div
          className="purchase-picker"
          aria-label="Kết quả nhà cung cấp"
          aria-busy={query.isFetching}
        >
          {query.isLoading && <p>Đang tải…</p>}
          {query.data?.data.map((s) => (
            <Button type="button" key={s.id} variant="ghost" onClick={() => onChange(s)}>
              {s.code} · {s.name}
            </Button>
          ))}
          {!query.isLoading && query.data?.data.length === 0 && (
            <p className="muted">Không có nhà cung cấp phù hợp.</p>
          )}
        </div>
      )}
    </div>
  );
}
