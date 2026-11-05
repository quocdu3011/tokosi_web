import type { Metadata } from 'next';
import { Suspense } from 'react';

import { FullPageLoader } from '@/components/common/full-page-loader';

import { CallbackScreen } from './callback-screen';

export const metadata: Metadata = { title: 'Đăng nhập Google' };

export default function CallbackPage() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <CallbackScreen />
    </Suspense>
  );
}
