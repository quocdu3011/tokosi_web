'use client';

import { useEffect, useRef, useState } from 'react';
import { ImageIcon, Info, Layers } from 'lucide-react';

import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/api';
import { useAuthStore } from '@/lib/auth/store';
import { useBranchStore } from '@/lib/branch';
import { can } from '@/lib/permissions';
import { useProduct, useUpdateProduct } from '@/lib/queries/products';

import { ImageManager } from './image-manager';
import { ProductStockSummary } from './product-stock-summary';
import { ProductInfoForm } from './product-info-form';
import { StockCardTab } from './stock-card-tab';

export type DrawerTarget = { kind: 'create' } | { kind: 'view'; id: string; tab?: DrawerTab };
export type DrawerTab = 'info' | 'stock-card';

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
  const updateProduct = useUpdateProduct();

  const { data: product, isLoading, isError, error } = useProduct(id);

  const branchId = useBranchStore((s) => s.branchId);
  const openedAt = useRef(branchId);
  useEffect(() => {
    if (branchId !== openedAt.current) onClose();
  }, [branchId, onClose]);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="product-workspace" aria-describedby={undefined}>
        <div className="product-workspace-header">
          <header>
            <SheetTitle>{product ? product.name : 'Thêm hàng hóa'}</SheetTitle>
            {product && (
              <div className="product-header-meta">
                <span>{product.code}</span>
                {product.productType === 'combo' && <Badge variant="info">Combo</Badge>}
              </div>
            )}
          </header>
        </div>
        <div className="product-workspace-body">
          {current.kind === 'create' ? (
            <ProductInfoForm
              product={null}
              onCancel={onClose}
              onSaved={(created) => {
                setCurrent({ kind: 'view', id: created.id });
                setTab('info');
              }}
            />
          ) : isError ? (
            <p className="alert alert-error" role="alert">
              {errorMessage(error)}
            </p>
          ) : isLoading || !product ? (
            <Skeleton className="skeleton-block" />
          ) : (
            <Tabs
              className="product-workspace-tabs"
              orientation="horizontal"
              value={tab}
              onValueChange={(v) => setTab(v as DrawerTab)}
            >
              <TabsList aria-label="Thông tin hàng hóa">
                <TabsTrigger value="info">
                  <Info aria-hidden="true" />
                  Thông tin
                </TabsTrigger>
                {product.productType === 'goods' && (
                  <TabsTrigger value="stock-card">
                    <Layers aria-hidden="true" />
                    Thẻ kho
                  </TabsTrigger>
                )}
              </TabsList>
              <div className="product-workspace-editor">
                <TabsContent value="info">
                  <ProductInfoForm
                    key={product.id}
                    product={product}
                    onCancel={onClose}
                    onSaved={() => undefined}
                    summary={
                      <aside
                        className="product-workspace-summary"
                        aria-label="Trạng thái và tồn kho"
                      >
                        <Select
                          value={product.isActive ? 'active' : 'inactive'}
                          disabled={!canEdit || updateProduct.isPending}
                          onValueChange={async (value) => {
                            const isActive = value === 'active';
                            if (isActive === product.isActive || updateProduct.isPending) return;
                            try {
                              await updateProduct.mutateAsync({
                                id: product.id,
                                patch: { isActive },
                              });
                              toast.success(
                                isActive ? 'Đã cho phép kinh doanh' : 'Đã ngừng kinh doanh',
                              );
                            } catch (error) {
                              toast.error(errorMessage(error));
                            }
                          }}
                        >
                          <SelectTrigger
                            className={`product-status ${product.isActive ? 'is-active' : 'is-inactive'}`}
                            aria-label="Trạng thái kinh doanh"
                            aria-busy={updateProduct.isPending}
                          >
                            <span className="product-status-dot" aria-hidden="true" />
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Đang kinh doanh</SelectItem>
                            <SelectItem value="inactive">Ngừng kinh doanh</SelectItem>
                          </SelectContent>
                        </Select>
                        <ProductStockSummary product={product} />
                      </aside>
                    }
                  >
                    <section
                      className="product-info-images"
                      aria-labelledby="product-images-heading"
                    >
                      <h3 id="product-images-heading">
                        <ImageIcon aria-hidden="true" />
                        Ảnh hàng hóa <span>({product.images.length})</span>
                      </h3>
                      <ImageManager product={product} canEdit={canEditImages} />
                    </section>
                  </ProductInfoForm>
                </TabsContent>
                {product.productType === 'goods' && (
                  <TabsContent value="stock-card">
                    <StockCardTab product={product} />
                  </TabsContent>
                )}
              </div>
            </Tabs>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
