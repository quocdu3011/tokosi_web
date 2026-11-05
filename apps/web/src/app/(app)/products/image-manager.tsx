'use client';

import { ArrowDown, ArrowUp, ImagePlus, Star, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';
import type { Product, ProductImage } from '@/lib/api/types';
import { MAX_IMAGES_PER_PRODUCT, validateImageFiles } from '@/lib/product-images';
import { useDeleteImage, useReorderImages, useUploadImages } from '@/lib/queries/product-images';

/** Tab "Ảnh": tải nhiều ảnh một lần, đổi thứ tự (ảnh đầu là ảnh đại diện) và xóa ảnh có xác nhận. */
export function ImageManager({ product, canEdit }: { product: Product; canEdit: boolean }) {
  const images = [...product.images].sort((a, b) => a.sortOrder - b.sortOrder);
  const upload = useUploadImages();
  const reorder = useReorderImages();
  const remove = useDeleteImage();
  const input = useRef<HTMLInputElement>(null);
  const [toDelete, setToDelete] = useState<ProductImage | null>(null);
  const busy = upload.isPending || reorder.isPending || remove.isPending;

  const onPick = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (input.current) input.current.value = '';
    if (files.length === 0) return;
    const problem = validateImageFiles(images.length, files);
    if (problem) {
      toast.error(problem);
      return;
    }
    try {
      await upload.mutateAsync({ id: product.id, files });
      toast.success(`Đã tải ${files.length} ảnh`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  /** Gửi ĐỦ id mọi ảnh theo thứ tự mới (API từ chối nếu thiếu/thừa). */
  const move = async (from: number, to: number) => {
    if (to < 0 || to >= images.length) return;
    const ids = images.map((i) => i.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved!);
    try {
      await reorder.mutateAsync({ id: product.id, imageIds: ids });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="stack-md">
      <div className="import-file">
        {canEdit && (
          <>
            <input
              ref={input}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-label="Chọn ảnh tải lên"
              onChange={(e) => void onPick(e.target.files)}
            />
            <Button
              variant="outline"
              onClick={() => input.current?.click()}
              disabled={busy || images.length >= MAX_IMAGES_PER_PRODUCT}
            >
              <ImagePlus aria-hidden="true" /> {upload.isPending ? 'Đang tải…' : 'Tải ảnh lên'}
            </Button>
          </>
        )}
        <span className="field-hint">
          {images.length}/{MAX_IMAGES_PER_PRODUCT} ảnh · JPEG, PNG, WebP · tối đa 5 MB mỗi ảnh
        </span>
      </div>

      {images.length === 0 ? (
        <p className="muted">Hàng này chưa có ảnh.</p>
      ) : (
        <ul className="image-grid">
          {images.map((img, i) => (
            <li key={img.id} className="image-card">
              {/* eslint-disable-next-line @next/next/no-img-element -- URL ảnh từ kho file/Excel, không qua tối ưu hóa của Next */}
              <img src={img.url} alt={`${product.name} - ảnh ${i + 1}`} loading="lazy" />
              {i === 0 && <span className="image-badge">Ảnh đại diện</span>}
              {canEdit && (
                <div className="image-actions">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Chuyển lên trước"
                    onClick={() => void move(i, i - 1)}
                    disabled={busy || i === 0}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Chuyển ra sau"
                    onClick={() => void move(i, i + 1)}
                    disabled={busy || i === images.length - 1}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  {i !== 0 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Đặt làm ảnh đại diện"
                      title="Đặt làm ảnh đại diện"
                      onClick={() => void move(i, 0)}
                      disabled={busy}
                    >
                      <Star aria-hidden="true" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Xóa ảnh"
                    onClick={() => setToDelete(img)}
                    disabled={busy}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Xóa ảnh này?"
          description="Ảnh sẽ bị gỡ khỏi hàng hóa và không khôi phục được. Hàng hóa không bị ảnh hưởng."
          confirmLabel="Xóa ảnh"
          destructive
          onConfirm={() => remove.mutateAsync({ id: product.id, imageId: toDelete.id })}
          onClose={() => setToDelete(null)}
        />
      )}
    </div>
  );
}
