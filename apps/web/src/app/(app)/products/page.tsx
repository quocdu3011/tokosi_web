import type { Metadata } from 'next';

import { RequirePermission } from '@/components/common/require-permission';

import { ProductsScreen } from './products-screen';

export const metadata: Metadata = { title: 'Danh sách hàng hóa' };

export default function Page() {
  return (
    <RequirePermission anyOf={['product.view']}>
      <ProductsScreen />
    </RequirePermission>
  );
}
