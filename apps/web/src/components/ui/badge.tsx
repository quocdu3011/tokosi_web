import * as React from 'react';

import { cn } from '@/lib/utils';

export type BadgeVariant =
  'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info';

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  default: 'badge-info',
  secondary: 'badge-neutral',
  destructive: 'badge-danger',
  outline: 'badge-neutral',
  success: 'badge-success',
  warning: 'badge-warning',
  info: 'badge-info',
};

/** Huy hiệu / viên thuốc trạng thái (MASTER 5.3, 5.6). */
function Badge({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'span'> & { variant?: BadgeVariant }) {
  return (
    <span data-slot="badge" className={cn('badge', VARIANT_CLASS[variant], className)} {...props} />
  );
}

export { Badge };
