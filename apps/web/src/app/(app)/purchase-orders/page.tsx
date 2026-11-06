import type { Metadata } from 'next';
import { PurchaseScreen } from '@/components/purchasing/purchase-screen';
export const metadata: Metadata = { title: 'Đặt hàng nhập' };
export default function Page() {
  return <PurchaseScreen kind="orders" />;
}
