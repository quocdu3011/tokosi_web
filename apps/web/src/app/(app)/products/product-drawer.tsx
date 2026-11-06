'use client';

import { useEffect, useRef, useState } from 'react';

import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/api';
import { useAuthStore } from '@/lib/auth/store';
import { useBranchStore } from '@/lib/branch';
import { can } from '@/lib/permissions';
import { useCategories, useProduct, useUpdateProduct } from '@/lib/queries/products';

import { ImageManager } from './image-manager';
import { ProductStockSummary } from './product-stock-summary';
import { ProductInfoForm } from './product-info-form';
import { StockCardTab } from './stock-card-tab';

export type DrawerTarget = { kind: 'create' } | { kind: 'view'; id: string; tab?: DrawerTab };
export type DrawerTab = 'info' | 'images' | 'stock-card';

/**
 * Ngăn kéo hàng hóa bên phải: tạo mới (chỉ tab Thông tin) hoặc xem/sửa một hàng (các tab).
 * Tồn, giá vốn tính theo chi nhánh làm việc nên đổi chi nhánh sẽ đóng ngăn kéo.
 */
export function ProductDrawer({ target, onClose }: { target: DrawerTarget; onClose: () => void }) {
  const me = useAuthStore((s) => s.user);
  const canEditImages = can(me, 'product.edit') || can(me, 'product.content.edit');
  const [current, setCurrent] = useState<DrawerTarget>(target);
  const [tab, setTab] = useState<DrawerTab>(
    target.kind === 'view' ? (target.tab ?? 'info') : 'info',
  );
  const id = current.kind === 'view' ? current.id : null;
  const canEdit = can(me, 'product.edit');
  const [confirmToggle, setConfirmToggle] = useState(false);
  const updateProduct = useUpdateProduct();

  const { data: product, isLoading, isError, error } = useProduct(id);
  const { data: categories = [] } = useCategories();

  const branchId = useBranchStore((s) => s.branchId);
  const openedAt = useRef(branchId);
  useEffect(() => {
    if (branchId !== openedAt.current) onClose();
  }, [branchId, onClose]);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="sheet-wide" aria-describedby={undefined}>
        <div className="drawer">
          <header className="drawer-header">
            <SheetTitle>
              {product ? `${product.code} · ${product.name}` : 'Thêm hàng hóa'}
            </SheetTitle>
            {product && (
              <div className="cell-badges">
                {product.isActive ? (
                  <Badge variant="success">Đang kinh doanh</Badge>
                ) : (
                  <Badge variant="destructive">Ngừng kinh doanh</Badge>
                )}
                {product.productType === 'combo' && <Badge variant="info">Combo</Badge>}
              </div>
            )}
            {product && canEdit && (
              <Button
                variant="ghost"
                size="sm"
                className="drawer-status-action"
                onClick={() => setConfirmToggle(true)}
              >
                {product.isActive ? 'Ngừng kinh doanh' : 'Cho phép kinh doanh'}
              </Button>
            )}
          </header>

          {current.kind === 'create' ? (
            <ProductInfoForm
              product={null}
              categories={categories}
              onCancel={onClose}
              onSaved={(created, opts) => {
                setCurrent({ kind: 'view', id: created.id });
                setTab(opts?.imagesFailed ? 'images' : 'info');
              }}
            />
          ) : isError ? (
            <p className="alert alert-error" role="alert">
              {errorMessage(error)}
            </p>
          ) : isLoading || !product ? (
            <Skeleton className="skeleton-block" />
          ) : (
            <Tabs value={tab} onValueChange={(v) => setTab(v as DrawerTab)}>
              <TabsList aria-label="Thông tin hàng hóa">
                <TabsTrigger value="info">Thông tin</TabsTrigger>
                <TabsTrigger value="images">Ảnh ({product.images.length})</TabsTrigger>
                {product.productType === 'goods' && (
                  <TabsTrigger value="stock-card">Thẻ kho</TabsTrigger>
                )}
              </TabsList>
              <TabsContent value="info">
                <ProductStockSummary product={product} />
                <ProductInfoForm
                  key={product.updatedAt}
                  product={product}
                  categories={categories}
                  onCancel={onClose}
                  onSaved={() => undefined}
                />
              </TabsContent>
              <TabsContent value="images">
                <ImageManager product={product} canEdit={canEditImages} />
              </TabsContent>
              {product.productType === 'goods' && (
                <TabsContent value="stock-card">
                  <StockCardTab product={product} />
                </TabsContent>
              )}
            </Tabs>
          )}
        </div>
        {product && confirmToggle && (
          <ConfirmDialog
            title={product.isActive ? 'Ngừng kinh doanh hàng này?' : 'Cho phép kinh doanh lại?'}
            description={
              product.isActive
                ? `${product.code} · ${product.name} sẽ không còn được chọn khi lập đơn. Dữ liệu và lịch sử giữ nguyên, có thể bật lại bất cứ lúc nào.`
                : `${product.code} · ${product.name} sẽ được kinh doanh trở lại.`
            }
            confirmLabel={product.isActive ? 'Ngừng kinh doanh' : 'Cho phép kinh doanh'}
            destructive={product.isActive}
            onConfirm={async () => {
              await updateProduct.mutateAsync({
                id: product.id,
                patch: { isActive: !product.isActive },
              });
              toast.success(product.isActive ? 'Đã ngừng kinh doanh' : 'Đã cho phép kinh doanh');
            }}
            onClose={() => setConfirmToggle(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
