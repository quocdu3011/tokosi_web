import type { Metadata } from 'next';
import { Suspense } from 'react';

import { FullPageLoader } from '@/components/common/full-page-loader';

import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Đăng nhập' };

export default function LoginPage() {
  // LoginForm đọc `?next=` bằng useSearchParams nên phải nằm trong Suspense.
  return (
    <Suspense fallback={<FullPageLoader />}>
      <LoginForm />
    </Suspense>
  );
}
