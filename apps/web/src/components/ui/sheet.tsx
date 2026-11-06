'use client';

import * as React from 'react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import { XIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Ngăn kéo trượt từ cạnh màn hình — dùng cho menu trên điện thoại. */
function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(props: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetContent({
  className,
  children,
  side = 'left',
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'left' | 'right';
  showCloseButton?: boolean;
}) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="modal-overlay" />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn('sheet-content', className)}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close className="modal-close">
            <XIcon />
            <span className="sr-only">Đóng</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title className={cn('modal-title', className)} {...props} />;
}

export { Sheet, SheetTrigger, SheetContent, SheetTitle };
