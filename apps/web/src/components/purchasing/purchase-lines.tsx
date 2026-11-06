'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useProductList } from '@/lib/queries/products';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { expandProduct, mergePurchaseRows, type PurchaseRow } from '@/lib/purchasing';
import { QueryError } from './query-feedback';

export function PurchaseLines({
  rows,
  onChange,
  returns,
  disabled,
}: {
  rows: PurchaseRow[];
  onChange: (rows: PurchaseRow[]) => void;
  returns: boolean;
  disabled: boolean;
}) {
  const [q, setQ] = useState('');
  const term = useDebouncedValue(q.trim(), 250);
  const query = useProductList({
    q: term,
    isActive: returns ? undefined : true,
    productType: returns ? 'goods' : undefined,
    page: 1,
    limit: 20, // cố ý: kết quả tìm nhanh trong ô thả xuống, không phải trang danh sách
  });
  const update = (index: number, field: 'qty' | 'unitCost', value: string) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  return (
    <div className="stack-md">
      <h3>Hàng hóa</h3>
      <Input
        aria-label="Tìm hàng để thêm vào phiếu"
        placeholder="Tìm mã hoặc tên hàng để thêm…"
        value={q}
        disabled={disabled}
        onChange={(e) => setQ(e.target.value)}
      />
      {term &&
        (query.isError ? (
          <QueryError error={query.error} retry={query.refetch} />
        ) : (
          <div className="purchase-picker" aria-label="Kết quả hàng hóa">
            {query.isFetching && <span>Đang tìm…</span>}
            {query.data?.data.map((product) => (
              <Button
                type="button"
                key={product.id}
                variant="ghost"
                disabled={disabled || query.isPlaceholderData}
                onClick={() => {
                  onChange(mergePurchaseRows(rows, expandProduct(product)));
                  setQ('');
                }}
              >
                {product.code} · {product.name}
                {product.productType === 'combo' ? ' (thêm các thành phần)' : ''}
              </Button>
            ))}
            {!query.isFetching && !query.data?.data.length && (
              <p className="muted">Không tìm thấy hàng phù hợp.</p>
            )}
          </div>
        ))}
      <div className="data-table-frame">
        <div className="data-table-scroll">
          <table className="data-table purchase-lines">
            <thead>
              <tr>
                <th scope="col">Hàng hóa</th>
                <th scope="col">Số lượng</th>
                <th scope="col">{returns ? 'Giá trả' : 'Giá nhập'}</th>
                <th scope="col">
                  <span className="sr-only">Xóa dòng</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.productId}>
                  <td>
                    <span className="cell-title">{row.code}</span>{' '}
                    <span className="cell-sub">{row.name}</span>
                  </td>
                  <td>
                    <Input
                      aria-label={`Số lượng ${row.code}`}
                      inputMode="decimal"
                      required
                      pattern="[0-9]+([.][0-9]{1,3})?"
                      value={row.qty}
                      disabled={disabled}
                      onChange={(e) => update(i, 'qty', e.target.value)}
                    />
                  </td>
                  <td>
                    <Input
                      aria-label={`Đơn giá ${row.code}`}
                      inputMode="decimal"
                      required
                      pattern="[0-9]+([.][0-9]{1,4})?"
                      value={row.unitCost}
                      disabled={disabled}
                      onChange={(e) => update(i, 'unitCost', e.target.value)}
                    />
                  </td>
                  <td>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={disabled}
                      aria-label={`Xóa ${row.code}`}
                      onClick={() => onChange(rows.filter((_, index) => index !== i))}
                    >
                      Xóa
                    </Button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={4} className="data-table-empty">
                    Tìm và chọn hàng để thêm vào phiếu.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="field-hint">
        Số lượng tối đa 3 số lẻ; giá tối đa 4 số lẻ. Dùng dấu chấm thập phân. Tổng tiền được cập
        nhật sau khi lưu phiếu.
      </p>
    </div>
  );
}
