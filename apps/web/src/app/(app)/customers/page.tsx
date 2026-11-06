import type { Metadata } from 'next';

import { CustomersScreen } from './customers-screen';

export const metadata: Metadata = { title: 'Khách hàng' };

export default function Page() {
  return <CustomersScreen />;
}
