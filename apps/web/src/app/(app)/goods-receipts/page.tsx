import type { Metadata } from 'next';

import { PurchaseScreen } from '@/components/purchasing/purchase-screen';

export const metadata: Metadata = { title: 'Nhập hàng' };

export default function Page() {
  return <PurchaseScreen kind="receipts" />;
}
