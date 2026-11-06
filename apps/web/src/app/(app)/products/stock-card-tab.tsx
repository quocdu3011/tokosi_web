'use client';

import { useState } from 'react';

import { Field } from '@/components/common/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import type { Product } from '@/lib/api/types';
import { formatDateTime, formatDecimal, formatMoney } from '@/lib/format';
import { useStockCard } from '@/lib/queries/products';
import { defaultStockRange, stockRefLabel } from '@/lib/stock-card';

/** Tab "Thẻ kho": lịch sử nhập–xuất của hàng tại chi nhánh đang làm việc theo khoảng ngày. */
export function StockCardTab({ product }: { product: Product }) {
  const [range, setRange] = useState(() => defaultStockRange());
  const valid = !!range.from && !!range.to && range.from <= range.to;
  const { data, isLoading, isError, error } = useStockCard(product.id, range, valid);

  return (
    <div className="stack-md">
      <div className="form-grid">
        <Field id="sc-from" label="Từ ngày">
          <Input
            id="sc-from"
            type="date"
            value={range.from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
          />
        </Field>
        <Field id="sc-to" label="Đến ngày">
          <Input
            id="sc-to"
            type="date"
            value={range.to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
          />
        </Field>
      </div>
      {!valid && (
        <p className="field-error" role="alert">
          Chọn khoảng ngày hợp lệ (từ ngày không sau đến ngày).
        </p>
      )}

      {isError ? (
        <p className="alert alert-error" role="alert">
          {errorMessage(error)}
        </p>
      ) : valid && (isLoading || !data) ? (
        <Skeleton className="skeleton-block" />
      ) : data ? (
        <>
          <p className="field-hint">
            Tồn đầu kỳ <strong className="tabular">{formatDecimal(data.openingQty) || '0'}</strong>
            {' · '}Tồn cuối kỳ{' '}
            <strong className="tabular">{formatDecimal(data.closingQty) || '0'}</strong>
          </p>
          {data.movements.length === 0 ? (
            <p className="muted">Không có phát sinh trong khoảng ngày này.</p>
          ) : (
            <div className="data-table-frame">
              <table className="data-table data-table-compact">
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th>Nghiệp vụ</th>
                    <th>Chứng từ</th>
                    <th className="num">Số lượng</th>
                    <th className="num">Tồn sau</th>
                    {data.movements.some((m) => m.unitCost !== undefined) && (
                      <th className="num">Giá vốn</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.movements.map((m, i) => {
                    const delta = Number(m.qtyDelta);
                    return (
                      <tr key={`${m.refId ?? 'x'}-${i}`}>
                        <td>{formatDateTime(m.occurredAt)}</td>
                        <td>{stockRefLabel(m.refType)}</td>
                        <td className="tabular">{m.refCode ?? ''}</td>
                        <td className={delta < 0 ? 'num stock-low' : 'num'}>
                          {delta > 0 ? '+' : ''}
                          {formatDecimal(m.qtyDelta) || '0'}
                        </td>
                        <td className="num">{formatDecimal(m.balance) || '0'}</td>
                        {data.movements.some((x) => x.unitCost !== undefined) && (
                          <td className="num">
                            {m.unitCost === undefined ? '' : formatMoney(m.unitCost)}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
