'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { ProductImage } from '@/lib/api/types';

export function ProductImageViewer({
  images,
  imageId,
  name,
  onChange,
  onClose,
}: {
  images: ProductImage[];
  imageId: string;
  name: string;
  onChange: (id: string) => void;
  onClose: () => void;
}) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const index = images.findIndex((image) => image.id === imageId);
  const image = images[index];
  const step = (direction: number) => {
    if (images.length < 2) return;
    onChange(images[(index + direction + images.length) % images.length]!.id);
  };

  return (
    <Dialog open={!!image} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="product-image-viewer"
        aria-describedby={undefined}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            event.stopPropagation();
            step(event.key === 'ArrowLeft' ? -1 : 1);
          }
        }}
      >
        <DialogTitle>{name}</DialogTitle>
        <div
          className="product-image-stage"
          onTouchStart={(event) => {
            const touch = event.touches[0];
            touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
          }}
          onTouchCancel={() => {
            touchStart.current = null;
          }}
          onTouchEnd={(event) => {
            const start = touchStart.current;
            const end = event.changedTouches[0];
            touchStart.current = null;
            if (!start || !end) return;
            const dx = end.clientX - start.x;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(end.clientY - start.y))
              step(dx < 0 ? 1 : -1);
          }}
        >
          {image && (
            // eslint-disable-next-line @next/next/no-img-element -- Original image from file storage.
            <img src={image.url} alt={`${name} - ảnh ${index + 1}`} draggable={false} />
          )}
          {images.length > 1 && (
            <>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="product-image-prev"
                aria-label="Ảnh trước"
                onClick={() => step(-1)}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="product-image-next"
                aria-label="Ảnh tiếp theo"
                onClick={() => step(1)}
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </>
          )}
        </div>
        <p className="product-image-counter" aria-live="polite" aria-atomic="true">
          Ảnh {index + 1} / {images.length}
        </p>
      </DialogContent>
    </Dialog>
  );
}
