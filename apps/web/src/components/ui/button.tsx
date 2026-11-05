import * as React from 'react';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

export type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  default: 'btn-primary',
  destructive: 'btn-danger',
  outline: 'btn-secondary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  link: 'btn-link',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  default: '',
  sm: 'btn-sm',
  lg: 'btn-lg',
  icon: 'btn-icon',
};

/** Tên lớp CSS của nút (MASTER 5.1) – dùng cho thẻ không phải <button>, vd. nút trong hộp thoại xác nhận. */
export function buttonVariants({
  variant = 'default',
  size = 'default',
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn('btn', VARIANT_CLASS[variant], SIZE_CLASS[size], className);
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp data-slot="button" className={buttonVariants({ variant, size, className })} {...props} />
  );
}

export { Button };
