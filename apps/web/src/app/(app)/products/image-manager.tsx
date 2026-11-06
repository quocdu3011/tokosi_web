'use client';

import { ImagePlus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<ProductImage | null>(null);
  const busy = upload.isPending || reorder.isPending || remove.isPending;

  const onPick = async (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []);
    if (input.current) input.current.value = '';
    if (!canEdit || busy || toDelete || files.length === 0) return;
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

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith('image/'),
      );
      if (!canEdit || toDelete || files.length === 0) return;
      event.preventDefault();
      if (busy) return;
      void onPick(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  });

  /** Gửi ĐỦ id mọi ảnh theo thứ tự mới (API từ chối nếu thiếu/thừa). */
  const move = async (from: number, to: number) => {
    if (!canEdit || busy || from < 0 || to < 0 || to >= images.length || from === to) return;
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

      {canEdit && (
        <p className="field-hint">
          Ctrl+V để dán ảnh · Kéo thả để sắp xếp · Ảnh đầu là ảnh đại diện
        </p>
      )}

      {images.length === 0 ? (
        <p className="muted">Hàng này chưa có ảnh.</p>
      ) : (
        <ul className="image-grid">
          {images.map((img, i) => (
            <li
              key={img.id}
              className={`image-card${dropId === img.id ? ' image-card-drop' : ''}`}
              draggable={canEdit && !busy && !toDelete}
              tabIndex={canEdit ? 0 : undefined}
              aria-label={`Ảnh ${i + 1}${i === 0 ? ', ảnh đại diện' : ''}`}
              title={canEdit ? 'Kéo thả hoặc dùng Alt và phím mũi tên để đổi thứ tự' : undefined}
              onKeyDown={(event) => {
                if (
                  !event.altKey ||
                  !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
                )
                  return;
                event.preventDefault();
                void move(i, i + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1));
              }}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', img.id);
                setDraggedId(img.id);
              }}
              onDragOver={(event) => {
                if (!draggedId || busy) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropId(img.id);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedId)
                  void move(
                    images.findIndex((image) => image.id === draggedId),
                    i,
                  );
                setDraggedId(null);
                setDropId(null);
              }}
              onDragEnd={() => {
                setDraggedId(null);
                setDropId(null);
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- URL ảnh từ kho file/Excel, không qua tối ưu hóa của Next */}
              <img
                src={img.url}
                alt={`${product.name} - ảnh ${i + 1}`}
                loading="lazy"
                draggable={false}
              />
              {i === 0 && <span className="image-badge">Ảnh đại diện</span>}
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="image-remove"
                  aria-label={`Xóa ảnh ${i + 1}`}
                  title="Xóa ảnh"
                  onDragStart={(event) => event.preventDefault()}
                  onClick={() => setToDelete(img)}
                  disabled={busy}
                >
                  <X aria-hidden="true" />
                </Button>
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
