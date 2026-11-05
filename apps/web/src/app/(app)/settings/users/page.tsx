import type { Metadata } from 'next';

import { RequirePermission } from '@/components/common/require-permission';

import { UsersScreen } from './users-screen';

export const metadata: Metadata = { title: 'Người dùng' };

export default function UsersPage() {
  return (
    <RequirePermission anyOf={['user.manage']}>
      <UsersScreen />
    </RequirePermission>
  );
}
