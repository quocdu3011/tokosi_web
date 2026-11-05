import type { Metadata } from 'next';

import { RequirePermission } from '@/components/common/require-permission';

import { RolesScreen } from './roles-screen';

export const metadata: Metadata = { title: 'Phân quyền' };

export default function RolesPage() {
  return (
    <RequirePermission anyOf={['role.manage']}>
      <RolesScreen />
    </RequirePermission>
  );
}
