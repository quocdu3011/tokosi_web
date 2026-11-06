import type { Metadata } from 'next';

import { SuppliersScreen } from './suppliers-screen';

export const metadata: Metadata = { title: 'Nhà cung cấp' };

export default function Page() {
  return <SuppliersScreen />;
}
