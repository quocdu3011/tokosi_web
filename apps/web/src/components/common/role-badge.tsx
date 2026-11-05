import { ROLE_LABELS, type Role } from '@kiot/shared';

import { cn } from '@/lib/utils';

/** Vai trò của web → lớp màu theo token `--role-*` của design system (MASTER 5.6). */
const ROLE_CLASS: Record<Role, string> = {
  manager: 'role-quan-ly',
  assistant: 'role-tro-ly',
  accountant: 'role-ke-toan',
  warehouse: 'role-nhan-vien-kho',
  driver: 'role-lai-xe',
  sales: 'role-nhan-vien-sale',
  marketing: 'role-nhan-vien-marketing',
};

export function RoleBadge({ role, className }: { role: string; className?: string }) {
  const known = role in ROLE_CLASS;
  return (
    <span className={cn('role-badge', known ? ROLE_CLASS[role as Role] : 'role-khach', className)}>
      {known ? ROLE_LABELS[role as Role] : role}
    </span>
  );
}
