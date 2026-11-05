import type { Metadata } from 'next';

import { RequirePermission } from '@/components/common/require-permission';

import { AuthSettingsScreen } from './auth-settings-screen';

export const metadata: Metadata = { title: 'Đăng nhập Google' };

export default function Page() {
  return (
    <RequirePermission anyOf={['user.manage']}>
      <AuthSettingsScreen />
    </RequirePermission>
  );
}
