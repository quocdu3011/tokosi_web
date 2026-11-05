'use client';

import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/api';
import { useAuthStore } from '@/lib/auth/store';
import { useBranchStore } from '@/lib/branch';
import { can } from '@/lib/permissions';
import { useCategories, useProduct } from '@/lib/queries/products';

import { ImageManager } from './image-manager';
import { ProductInfoForm } from './product-info-form';

export type DrawerTarget = { kind: 'create' } | { kind: 'view'; id: string; tab?: DrawerTab };
export type DrawerTab = 'info' | 'images';

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
              </TabsList>
              <TabsContent value="info">
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
            </Tabs>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
