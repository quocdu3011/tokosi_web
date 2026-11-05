'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import type { Product, ProductBranch } from '@/lib/api/types';
import { formatDecimal, formatMoney } from '@/lib/format';
import { useProductBranches } from '@/lib/queries/products';

/**
 * Tab "Theo chi nhánh": tồn kho và giá vốn của hàng ở từng chi nhánh người dùng được phép (chỉ xem).
 * Combo không có tồn riêng: số liệu tính từ hàng thành phần.
 */
export function ProductBranchesTab({ product }: { product: Product }) {
  const { data, isLoading, isError, error } = useProductBranches(product.id);

  if (isError) {
    return (
      <p className="alert alert-error" role="alert">
        {errorMessage(error)}
      </p>
    );
  }
  if (isLoading || !data) return <Skeleton className="skeleton-block" />;

  return (
    <div className="stack-md">
      {product.productType === 'combo' && (
        <p className="field-hint">Combo không có tồn riêng: số liệu tính từ hàng thành phần.</p>
      )}
      {data.map((b) => (
        <BranchCard key={b.branchId} branch={b} />
      ))}
    </div>
  );
}

function BranchCard({ branch }: { branch: ProductBranch }) {
  return (
    <section className="branch-card" aria-label={branch.branchName}>
      <h3 className="branch-card-title">
        {branch.branchName} <span className="muted">({branch.branchCode})</span>
      </h3>
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
