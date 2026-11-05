'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { Field } from '@/components/common/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import type { Product, ProductBranch } from '@/lib/api/types';
import { formatDecimal, formatMoney } from '@/lib/format';
import { branchSettingsProblem, toNullable } from '@/lib/product-branch';
import { useProductBranches, useSaveProductBranch } from '@/lib/queries/products';

/**
 * Tab "Theo chi nhánh": tồn, giá vốn từng chi nhánh người dùng được phép và (khi có `product.edit`)
 * tồn tối thiểu/tối đa, vị trí kho. Combo không có tồn riêng nên chỉ xem.
 */
export function ProductBranchesTab({ product, canEdit }: { product: Product; canEdit: boolean }) {
  const { data, isLoading, isError, error } = useProductBranches(product.id);
  const isCombo = product.productType === 'combo';

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
      {isCombo && (
        <p className="field-hint">
          Combo không có tồn riêng: số liệu tính từ hàng thành phần. Đặt tồn tối thiểu/tối đa và vị
          trí ở từng hàng thành phần.
        </p>
      )}
      {data.map((b) => (
        <BranchCard
          key={b.branchId}
          productId={product.id}
          branch={b}
          editable={canEdit && !isCombo}
        />
      ))}
    </div>
  );
}

function BranchCard({
  productId,
  branch,
  editable,
}: {
  productId: string;
  branch: ProductBranch;
  editable: boolean;
}) {
  const save = useSaveProductBranch();
  const [minStock, setMin] = useState(branch.minStock ?? '');
  const [maxStock, setMax] = useState(branch.maxStock ?? '');
  const [location, setLocation] = useState(branch.location ?? '');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    const p = branchSettingsProblem(minStock, maxStock);
    setProblem(p);
    if (p) return;
    try {
      await save.mutateAsync({
        id: productId,
        branchId: branch.branchId,
        settings: {
          minStock: toNullable(minStock),
          maxStock: toNullable(maxStock),
          location: toNullable(location),
        },
      });
      toast.success(`Đã lưu thiết lập tại ${branch.branchName}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const fid = (n: string) => `pb-${branch.branchId}-${n}`;

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

      {editable ? (
        <div className="form-grid">
          <Field id={fid('min')} label="Tồn tối thiểu">
            <Input
              id={fid('min')}
              inputMode="decimal"
              value={minStock}
              onChange={(e) => setMin(e.target.value)}
            />
          </Field>
          <Field id={fid('max')} label="Tồn tối đa">
            <Input
              id={fid('max')}
              inputMode="decimal"
              value={maxStock}
              onChange={(e) => setMax(e.target.value)}
            />
          </Field>
          <Field id={fid('loc')} label="Vị trí kho" className="span-2">
            <Input id={fid('loc')} value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
          {problem && (
            <p className="field-error span-2" role="alert">
              {problem}
            </p>
          )}
          <div className="span-2 form-actions">
            <Button onClick={() => void submit()} disabled={save.isPending}>
              {save.isPending && <span className="spinner" aria-hidden="true" />}
              Lưu thiết lập
            </Button>
          </div>
        </div>
      ) : (
        !branch.minStock &&
        !branch.maxStock &&
        !branch.location && <p className="muted">Chưa đặt tồn tối thiểu/tối đa hay vị trí kho.</p>
      )}
      {!editable && (branch.minStock || branch.maxStock || branch.location) && (
        <p className="field-hint">
          Tối thiểu {formatDecimal(branch.minStock) || '—'} · Tối đa{' '}
          {formatDecimal(branch.maxStock) || '—'} · Vị trí {branch.location ?? '—'}
        </p>
      )}
    </section>
  );
}
