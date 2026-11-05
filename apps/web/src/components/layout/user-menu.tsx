'use client';

import { ROLE_LABELS, type Role } from '@kiot/shared';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogOut, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { logout } from '@/lib/auth/session';
import { useAuthStore } from '@/lib/auth/store';

export function UserMenu() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const queryClient = useQueryClient();
  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button id="user-menu" variant="ghost" size="sm" aria-label="Tài khoản">
          <UserRound />
          <span className="user-menu-name">{user.fullName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="menu-label-user">
          <strong>{user.fullName}</strong>
          <small>
            {user.username} · {ROLE_LABELS[user.role as Role]}
          </small>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push('/change-password')}>
          <KeyRound /> Đổi mật khẩu
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={async () => {
            await logout(queryClient).catch(() => undefined);
            router.replace('/login');
          }}
        >
          <LogOut /> Đăng xuất
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
