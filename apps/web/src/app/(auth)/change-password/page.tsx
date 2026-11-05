import type { Metadata } from 'next';

import { ChangePasswordForm } from './change-password-form';

export const metadata: Metadata = { title: 'Đổi mật khẩu' };

export default function ChangePasswordPage() {
  return <ChangePasswordForm />;
}
