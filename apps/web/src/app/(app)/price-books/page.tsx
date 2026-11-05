import type { Metadata } from 'next';

import { RequirePermission } from '@/components/common/require-permission';

import { PriceBooksScreen } from './price-books-screen';

export const metadata: Metadata = { title: 'Thiết lập giá' };

export default function Page() {
  return (
    <RequirePermission anyOf={['product.view']}>
      <PriceBooksScreen />
    </RequirePermission>
  );
}
