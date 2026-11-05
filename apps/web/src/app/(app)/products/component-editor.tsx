'use client';

import { Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import type { ComponentRow } from '@/lib/product-components';
import { useProductLookup } from '@/lib/queries/products';

/** Dòng hàng thành phần kèm tên để hiển thị (chỉ `code` và `qty` được gửi lên API). */
export interface EditorRow extends ComponentRow {
  name: string;
}

/**
 * Bảng hàng thành phần của Combo: tìm hàng (loại trừ Combo khác và hàng đã có) rồi nhập số lượng
 * nguyên dương trong MỘT combo.
 */
export function ComponentEditor({
  rows,
  onChange,
  disabled,
  selfCode,
}: {
  rows: EditorRow[];
  onChange: (rows: EditorRow[]) => void;
  disabled?: boolean;
  /** Mã của chính combo đang sửa (nếu có) để không tự chọn mình. */
  selfCode?: string;
}) {
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q.trim());
  const { data: found = [], isFetching } = useProductLookup(debouncedQ);

  const taken = new Set(rows.map((r) => r.code.toLowerCase()));
  const options = found.filter(
    (p) =>
      p.productType === 'goods' &&
      !taken.has(p.code.toLowerCase()) &&
      p.code.toLowerCase() !== selfCode?.toLowerCase(),
  );

  const setQty = (index: number, value: string) => {
    const qty = /^\d+$/.test(value) ? Number(value) : 0;
    onChange(rows.map((r, i) => (i === index ? { ...r, qty } : r)));
  };

  return (
    <div className="stack-sm">
      {rows.length > 0 ? (
        <table className="mini-table">
          <thead>
            <tr>
              <th>Mã hàng</th>
              <th>Tên hàng</th>
              <th className="num">Số lượng / combo</th>
              <th>
                <span className="sr-only">Gỡ</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.code}>
                <td className="tabular">{r.code}</td>
                <td>{r.name}</td>
                <td className="num">
                  <Input
                    inputMode="numeric"
                    className="qty-input"
                    aria-label={`Số lượng ${r.code} trong một combo`}
                    value={r.qty === 0 ? '' : String(r.qty)}
                    onChange={(e) => setQty(i, e.target.value)}
                    disabled={disabled}
                  />
                </td>
                <td>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Gỡ ${r.code} khỏi combo`}
                    onClick={() => onChange(rows.filter((_, j) => j !== i))}
                    disabled={disabled}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="field-hint">Chưa có hàng thành phần nào.</p>
      )}

      {!disabled && (
        <div className="stack-sm">
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm mã hoặc tên hàng để thêm vào combo"
            aria-label="Tìm hàng thành phần"
            autoComplete="off"
          />
          {debouncedQ && (
            <ul className="pick-list" aria-label="Kết quả tìm hàng">
              {options.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange([...rows, { code: p.code, name: p.name, qty: 1 }]);
                      setQ('');
                    }}
                  >
                    <span className="tabular">{p.code}</span> <span>{p.name}</span>
                  </button>
                </li>
              ))}
              {options.length === 0 && (
                <li className="pick-empty">
                  {isFetching ? 'Đang tìm…' : 'Không có hàng phù hợp (chỉ chọn được hàng hóa)'}
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
