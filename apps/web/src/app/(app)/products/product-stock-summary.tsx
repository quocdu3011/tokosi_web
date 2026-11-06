'use client';

import type { Product } from '@/lib/api/types';
import { formatDecimal, formatMoney } from '@/lib/format';

/**
 * Tồn kho và giá vốn của hàng tại chi nhánh đang làm việc (chỉ xem).
 * Combo không có tồn riêng: số liệu tính từ hàng thành phần.
 */
export function ProductStockSummary({ product: branch }: { product: Product }) {
  return (
    <section className="branch-card" aria-label="Tồn kho tại chi nhánh đang làm việc">
      <h3 className="branch-card-title">Tồn kho tại chi nhánh đang làm việc</h3>
      {branch.productType === 'combo' && (
        <p className="field-hint">Combo không có tồn riêng: số liệu tính từ hàng thành phần.</p>
      )}
      <dl className="stat-row">
        <div>
          <dt>Tồn kho</dt>
          <dd className="tabular">{formatDecimal(branch.onHand) || '0'}</dd>
        </div>
        <div>
          <dt>Khách đặt</dt>
          <dd className="tabular">{formatDecimal(branch.reserved) || '0'}</dd>
        </div>
        <div>
          <dt>Có thể bán</dt>
          <dd className="tabular">{formatDecimal(branch.available) || '0'}</dd>
        </div>
        {branch.costPrice !== undefined && (
          <div>
            <dt>Giá vốn</dt>
            <dd className="tabular">{formatMoney(branch.costPrice)}</dd>
          </div>
        )}
        {branch.lastPurchasePrice !== undefined && (
          <div>
            <dt>Giá nhập cuối</dt>
            <dd className="tabular">
              {branch.lastPurchasePrice === null
                ? 'Chưa có'
                : formatMoney(branch.lastPurchasePrice)}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
