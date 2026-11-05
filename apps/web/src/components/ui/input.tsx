import * as React from 'react';

import { cn } from '@/lib/utils';

/** Ô nhập một dòng (MASTER 5.4). Trạng thái lỗi qua `aria-invalid`. */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return <input type={type} data-slot="input" className={cn('form-input', className)} {...props} />;
}

export { Input };
