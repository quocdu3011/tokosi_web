import type { Metadata } from 'next';

import { RequirePermission } from '@/components/common/require-permission';

import { CategoriesScreen } from './categories-screen';

export const metadata: Metadata = { title: 'Nhóm hàng' };

export default function Page() {
  return (
    <RequirePermission anyOf={['product.view']}>
      <CategoriesScreen />
    </RequirePermission>
  );
}
